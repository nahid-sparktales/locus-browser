import { createHash, verify } from "node:crypto";
import { strFromU8, unzipSync } from "fflate";
import { z } from "zod";

export const capabilityRegistry = {
  contractVersion: 1,
  manifestVersion: 3,
  supportedManifestKeys: [
    "manifest_version", "name", "version", "description", "icons", "action",
    "background", "content_scripts", "permissions", "host_permissions",
    "optional_permissions", "optional_host_permissions", "commands", "storage",
    "content_security_policy", "web_accessible_resources", "minimum_locus_version",
  ],
  permissions: [
    "activeTab", "scripting", "storage", "contextMenus", "notifications",
    "downloads", "bookmarks", "history", "webRequest", "declarativeNetRequest",
  ],
} as const;

const ManifestSchema = z.object({
  manifest_version: z.literal(3),
  name: z.string().trim().min(1).max(80),
  version: z.string().regex(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/),
  description: z.string().max(500).optional(),
  permissions: z.array(z.string()).default([]),
  optional_permissions: z.array(z.string()).default([]),
  host_permissions: z.array(z.string()).default([]),
  optional_host_permissions: z.array(z.string()).default([]),
}).passthrough();

const InventorySchema = z.object({
  files: z.array(z.object({
    path: z.string().min(1),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    size: z.number().int().nonnegative().max(25 * 1024 * 1024),
  })).min(1).max(5_000),
});

const SignaturesSchema = z.object({
  publisher: z.object({ publicKeyPem: z.string().min(1), signature: z.string().min(1) }),
  gallery: z.object({ publicKeyPem: z.string().min(1), signature: z.string().min(1) }),
});

export type LocusExtensionManifest = z.infer<typeof ManifestSchema>;

export interface VerifiedLocusExtension {
  id: string;
  manifest: LocusExtensionManifest;
  files: ReadonlyMap<string, Uint8Array>;
  publisherFingerprint: string;
  galleryFingerprint: string;
}

export function validateManifest(raw: unknown): LocusExtensionManifest {
  const parsed = ManifestSchema.parse(raw);
  const unknownKeys = Object.keys(parsed).filter(
    (key) => !capabilityRegistry.supportedManifestKeys.includes(key as never),
  );
  if (unknownKeys.length) throw new Error(`Unsupported manifest keys: ${unknownKeys.join(", ")}`);
  const unsupportedPermissions = [...parsed.permissions, ...parsed.optional_permissions].filter(
    (permission) => !capabilityRegistry.permissions.includes(permission as never),
  );
  if (unsupportedPermissions.length) {
    throw new Error(`Unsupported extension permissions: ${[...new Set(unsupportedPermissions)].join(", ")}`);
  }
  for (const pattern of [...parsed.host_permissions, ...parsed.optional_host_permissions]) validateHostPattern(pattern);
  return parsed;
}

export function verifyLocusx(archive: Uint8Array, trustedGalleryFingerprints: ReadonlySet<string>): VerifiedLocusExtension {
  if (archive.byteLength > 50 * 1024 * 1024) throw new Error("Extension archive exceeds 50 MB");
  const files = new Map(Object.entries(unzipSync(archive)));
  for (const path of files.keys()) validateArchivePath(path);

  const manifestBytes = required(files, "manifest.json");
  const inventoryBytes = required(files, "inventory.json");
  const signaturesBytes = required(files, "signatures.json");
  const manifest = validateManifest(JSON.parse(strFromU8(manifestBytes)));
  const inventory = InventorySchema.parse(JSON.parse(strFromU8(inventoryBytes)));
  const signatures = SignaturesSchema.parse(JSON.parse(strFromU8(signaturesBytes)));

  const inventoryPaths = new Set(inventory.files.map((item) => item.path));
  for (const item of inventory.files) {
    validateArchivePath(item.path);
    const bytes = required(files, item.path);
    if (bytes.byteLength !== item.size) throw new Error(`Size mismatch for ${item.path}`);
    if (sha256(bytes) !== item.sha256) throw new Error(`SHA-256 mismatch for ${item.path}`);
    scanForRemoteCode(item.path, bytes);
  }
  for (const path of files.keys()) {
    if (!["inventory.json", "signatures.json"].includes(path) && !inventoryPaths.has(path)) {
      throw new Error(`Uninventoried file: ${path}`);
    }
  }

  const signedMessage = Buffer.from(`${sha256(manifestBytes)}:${sha256(inventoryBytes)}`, "utf8");
  if (!verify(null, signedMessage, signatures.publisher.publicKeyPem, Buffer.from(signatures.publisher.signature, "base64"))) {
    throw new Error("Invalid publisher signature");
  }
  if (!verify(null, signedMessage, signatures.gallery.publicKeyPem, Buffer.from(signatures.gallery.signature, "base64"))) {
    throw new Error("Invalid gallery countersignature");
  }
  const galleryFingerprint = fingerprint(signatures.gallery.publicKeyPem);
  if (!trustedGalleryFingerprints.has(galleryFingerprint)) throw new Error("Gallery signing key is not trusted");
  const publisherFingerprint = fingerprint(signatures.publisher.publicKeyPem);
  return {
    id: sha256(Buffer.from(publisherFingerprint)).slice(0, 32),
    manifest,
    files,
    publisherFingerprint,
    galleryFingerprint,
  };
}

export function permissionExpansion(previous: LocusExtensionManifest, next: LocusExtensionManifest): string[] {
  const existing = new Set([
    ...previous.permissions,
    ...previous.optional_permissions,
    ...previous.host_permissions,
    ...previous.optional_host_permissions,
  ]);
  return [
    ...next.permissions,
    ...next.optional_permissions,
    ...next.host_permissions,
    ...next.optional_host_permissions,
  ].filter((permission) => !existing.has(permission));
}

function required(files: ReadonlyMap<string, Uint8Array>, path: string): Uint8Array {
  const value = files.get(path);
  if (!value) throw new Error(`Missing ${path}`);
  return value;
}

function validateArchivePath(path: string): void {
  if (!path || path.startsWith("/") || path.includes("\\") || path.split("/").includes("..")) {
    throw new Error(`Unsafe extension path: ${path}`);
  }
}

function validateHostPattern(pattern: string): void {
  if (pattern === "<all_urls>") return;
  if (!/^(https?|\*):\/\/(\*\.)?[A-Za-z0-9.-]+\/.*$/.test(pattern)) {
    throw new Error(`Unsupported host permission pattern: ${pattern}`);
  }
}

function scanForRemoteCode(path: string, bytes: Uint8Array): void {
  if (!/\.(?:js|mjs|cjs|html|json)$/i.test(path)) return;
  const source = strFromU8(bytes);
  if (/\b(?:eval|Function)\s*\(/.test(source)) throw new Error(`Dynamic code execution is forbidden in ${path}`);
  if (/https?:\/\/[^\s"']+\.(?:js|mjs)(?:[?"']|$)/i.test(source)) throw new Error(`Remote executable code is forbidden in ${path}`);
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function fingerprint(publicKeyPem: string): string {
  return sha256(Buffer.from(publicKeyPem.replace(/\s+/g, "")));
}
