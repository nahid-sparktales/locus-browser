import { createHash, createPublicKey, verify } from "node:crypto";
import { strFromU8, unzipSync } from "fflate";
import { z } from "zod";

export const locusxContractVersion = 2;

export const trustedGalleryKeys = [{
  id: "locus-canary-2026-08",
  name: "Locus Canary Gallery",
  channel: "canary",
  fingerprint: "52064709bc12f9096b378a96a8d266e67c6a42b0c7b2accb4133686b768c09b4",
}] as const;

export const capabilityRegistry = {
  contractVersion: 2,
  manifestVersion: 3,
  supportedManifestKeys: [
    "manifest_version", "name", "version", "description", "icons", "author",
    "short_name", "default_locale", "minimum_chrome_version", "key", "content_scripts",
    "permissions", "host_permissions", "optional_permissions", "optional_host_permissions",
  ],
  permissions: [
    "activeTab", "scripting", "storage", "tabs", "webRequest",
  ],
} as const;

const ContentScriptsSchema = z.array(z.object({
  matches: z.array(z.string()).min(1).max(200),
  exclude_matches: z.array(z.string()).max(200).optional(),
  js: z.array(z.string()).max(200).optional(),
  css: z.array(z.string()).max(200).optional(),
  run_at: z.enum(["document_start", "document_end", "document_idle"]).optional(),
  all_frames: z.boolean().optional(),
  match_about_blank: z.boolean().optional(),
}).strict()).max(200);

const ManifestSchema = z.object({
  manifest_version: z.literal(3),
  name: z.string().trim().min(1).max(80),
  version: z.string().regex(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/),
  description: z.string().max(500).optional(),
  icons: z.record(z.string(), z.string()).optional(),
  author: z.string().max(200).optional(),
  short_name: z.string().trim().min(1).max(40).optional(),
  default_locale: z.string().regex(/^[A-Za-z0-9_-]{2,20}$/).optional(),
  minimum_chrome_version: z.string().regex(/^\d+(?:\.\d+){0,3}$/).optional(),
  key: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/).max(8_192).optional(),
  content_scripts: ContentScriptsSchema.default([]),
  permissions: z.array(z.string()).max(200).default([]),
  optional_permissions: z.array(z.string()).max(200).default([]),
  host_permissions: z.array(z.string()).max(200).default([]),
  optional_host_permissions: z.array(z.string()).max(200).default([]),
}).passthrough();

const InventorySchema = z.object({
  files: z.array(z.object({
    path: z.string().min(1),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    size: z.number().int().nonnegative().max(25 * 1024 * 1024),
  }).strict()).min(1).max(5_000),
}).strict().superRefine((inventory, context) => {
  const paths = new Set<string>();
  for (const file of inventory.files) {
    if (paths.has(file.path)) context.addIssue({ code: "custom", message: `Duplicate inventory path: ${file.path}` });
    paths.add(file.path);
  }
});

const SignaturesSchema = z.object({
  contractVersion: z.literal(locusxContractVersion),
  extensionId: z.string().regex(/^[a-z0-9](?:[a-z0-9.-]{1,126}[a-z0-9])?$/),
  publisher: z.object({
    publicKeyPem: z.string().min(1).max(8_192),
    signature: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/).max(512),
  }).strict(),
  gallery: z.object({
    publicKeyPem: z.string().min(1).max(8_192),
    signature: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/).max(512),
  }).strict(),
}).strict();

export type LocusExtensionManifest = z.infer<typeof ManifestSchema>;

export interface VerifiedLocusExtension {
  id: string;
  manifest: LocusExtensionManifest;
  files: ReadonlyMap<string, Uint8Array>;
  publisherFingerprint: string;
  galleryFingerprint: string;
}

export const trustedGalleryFingerprints = new Set(trustedGalleryKeys.map((key) => key.fingerprint));

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
  for (const script of parsed.content_scripts) {
    for (const pattern of [...script.matches, ...(script.exclude_matches ?? [])]) validateHostPattern(pattern);
    for (const path of [...(script.js ?? []), ...(script.css ?? [])]) validateRelativeExtensionPath(path);
    if (!(script.js?.length || script.css?.length)) throw new Error("Content scripts must include local JavaScript or CSS files");
  }
  if (parsed.icons !== undefined) {
    for (const [size, path] of Object.entries(parsed.icons)) {
      if (!/^\d{1,4}$/.test(size)) throw new Error("Extension icons must use numeric sizes and local paths");
      validateRelativeExtensionPath(path);
    }
  }
  return parsed;
}

export function verifyLocusx(archive: Uint8Array, trustedGalleryFingerprints: ReadonlySet<string>): VerifiedLocusExtension {
  if (archive.byteLength > 50 * 1024 * 1024) throw new Error("Extension archive exceeds 50 MB");
  let expandedBytes = 0;
  let entryCount = 0;
  const entryPaths = new Set<string>();
  const files = new Map(Object.entries(unzipSync(archive, { filter: (file) => {
    validateArchivePath(file.name);
    if (entryPaths.has(file.name)) throw new Error(`Duplicate extension archive path: ${file.name}`);
    entryPaths.add(file.name);
    entryCount += 1;
    if (entryCount > 5_002) throw new Error("Extension archive contains too many files");
    if (file.originalSize > 25 * 1024 * 1024) throw new Error(`Extension file exceeds 25 MB: ${file.name}`);
    expandedBytes += file.originalSize;
    if (expandedBytes > 50 * 1024 * 1024) throw new Error("Expanded extension archive exceeds 50 MB");
    return true;
  } })));

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
    validateExtensionFile(item.path, bytes);
  }
  for (const path of files.keys()) {
    if (!["inventory.json", "signatures.json"].includes(path) && !inventoryPaths.has(path)) {
      throw new Error(`Uninventoried file: ${path}`);
    }
  }
  for (const path of extensionLocalResources(manifest)) required(files, path);

  const publisherFingerprint = publicKeyFingerprint(signatures.publisher.publicKeyPem);
  const publisherSignature = Buffer.from(signatures.publisher.signature, "base64");
  const publisherMessage = locusxPublisherMessage(signatures.extensionId, manifestBytes, inventoryBytes);
  if (!verify(null, publisherMessage, signatures.publisher.publicKeyPem, publisherSignature)) {
    throw new Error("Invalid publisher signature");
  }
  const expectedManifestKey = createPublicKey(signatures.publisher.publicKeyPem)
    .export({ format: "der", type: "spki" })
    .toString("base64");
  if (manifest.key !== expectedManifestKey) {
    throw new Error("Signed extension manifest key must match the verified publisher key");
  }
  const galleryMessage = locusxGalleryMessage(publisherMessage, publisherFingerprint, publisherSignature);
  if (!verify(null, galleryMessage, signatures.gallery.publicKeyPem, Buffer.from(signatures.gallery.signature, "base64"))) {
    throw new Error("Invalid gallery countersignature");
  }
  const galleryFingerprint = publicKeyFingerprint(signatures.gallery.publicKeyPem);
  if (!trustedGalleryFingerprints.has(galleryFingerprint)) throw new Error("Gallery signing key is not trusted");
  return {
    id: signatures.extensionId,
    manifest,
    files,
    publisherFingerprint,
    galleryFingerprint,
  };
}

export function locusxPublisherMessage(extensionId: string, manifestBytes: Uint8Array, inventoryBytes: Uint8Array): Uint8Array {
  return Buffer.from(`${locusxContractVersion}:${extensionId}:${sha256(manifestBytes)}:${sha256(inventoryBytes)}`, "utf8");
}

export function locusxGalleryMessage(publisherMessage: Uint8Array, publisherFingerprint: string, publisherSignature: Uint8Array): Uint8Array {
  return Buffer.from(`${sha256(publisherMessage)}:${publisherFingerprint}:${sha256(publisherSignature)}`, "utf8");
}

export function permissionExpansion(previous: LocusExtensionManifest, next: LocusExtensionManifest): string[] {
  const existing = new Set([
    ...previous.permissions,
    ...previous.optional_permissions,
    ...previous.host_permissions,
    ...previous.optional_host_permissions,
    ...extensionContentScriptMatches(previous),
  ]);
  return [...new Set([
    ...next.permissions,
    ...next.optional_permissions,
    ...next.host_permissions,
    ...next.optional_host_permissions,
    ...extensionContentScriptMatches(next),
  ].filter((permission) => !existing.has(permission)))];
}

export function extensionContentScriptMatches(manifest: LocusExtensionManifest): string[] {
  return [...new Set(manifest.content_scripts.flatMap((script) => script.matches))];
}

export function extensionLocalResources(manifest: LocusExtensionManifest): string[] {
  return [...new Set([
    ...manifest.content_scripts.flatMap((script) => [...(script.js ?? []), ...(script.css ?? [])]),
    ...Object.values(manifest.icons ?? {}),
  ])];
}

function required(files: ReadonlyMap<string, Uint8Array>, path: string): Uint8Array {
  const value = files.get(path);
  if (!value) throw new Error(`Missing ${path}`);
  return value;
}

function validateArchivePath(path: string): void {
  const segments = path.split("/");
  if (!path || path.startsWith("/") || path.includes("\\") || path.includes("\0") || segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`Unsafe extension path: ${path}`);
  }
}

function validateHostPattern(pattern: string): void {
  if (pattern === "<all_urls>") return;
  if (!/^(https?|\*):\/\/(?:\*|\*\.[A-Za-z0-9.-]+|[A-Za-z0-9.-]+)\/.*$/.test(pattern)) {
    throw new Error(`Unsupported host permission pattern: ${pattern}`);
  }
}

function validateRelativeExtensionPath(path: string): void {
  if (!path || path.startsWith("/") || path.includes("\\") || path.split("/").includes("..") || /^[a-z][a-z0-9+.-]*:/i.test(path)) {
    throw new Error(`Unsafe extension resource path: ${path}`);
  }
}

export function validateExtensionFile(path: string, bytes: Uint8Array): void {
  if (!/\.(?:js|mjs|cjs|html|json)$/i.test(path)) return;
  const source = strFromU8(bytes);
  if (/\b(?:eval|Function)\s*\(/.test(source)) throw new Error(`Dynamic code execution is forbidden in ${path}`);
  if (/https?:\/\/[^\s"']+\.(?:js|mjs)(?:[?"']|$)/i.test(source)) throw new Error(`Remote executable code is forbidden in ${path}`);
  if (/<script\b[^>]*\bsrc\s*=\s*["']https?:\/\//i.test(source)) throw new Error(`Remote executable code is forbidden in ${path}`);
  if (/\b(?:import\s*\(|from\s+)["']https?:\/\//i.test(source)) throw new Error(`Remote executable code is forbidden in ${path}`);
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function publicKeyFingerprint(publicKeyPem: string): string {
  return sha256(Buffer.from(publicKeyPem.replace(/\s+/g, "")));
}
