import { createPublicKey, verify } from "node:crypto";
import { strFromU8, unzipSync } from "fflate";
import { z } from "zod";
import { locusxContractVersion } from "./contract.js";
import { publicKeyFingerprint, sha256 } from "./crypto.js";
import {
  extensionLocalResources,
  type LocusExtensionManifest,
  validateArchivePath,
  validateExtensionFile,
  validateManifest,
} from "./manifest.js";

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

export interface VerifiedLocusExtension {
  id: string;
  manifest: LocusExtensionManifest;
  files: ReadonlyMap<string, Uint8Array>;
  publisherFingerprint: string;
  galleryFingerprint: string;
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

function required(files: ReadonlyMap<string, Uint8Array>, path: string): Uint8Array {
  const value = files.get(path);
  if (!value) throw new Error(`Missing ${path}`);
  return value;
}
