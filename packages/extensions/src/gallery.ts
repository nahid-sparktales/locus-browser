import { verify } from "node:crypto";
import { z } from "zod";
import {
  extensionGalleryCatalogVersion,
  extensionGalleryDocumentVersion,
  locusxContractVersion,
} from "./contract.js";
import { publicKeyFingerprint } from "./crypto.js";

export const ExtensionGalleryEntrySchema = z.object({
  id: z.string().regex(/^[a-z0-9](?:[a-z0-9.-]{1,126}[a-z0-9])?$/),
  name: z.string().trim().min(1).max(80),
  version: z.string().regex(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/),
  description: z.string().max(500).optional(),
  publisherFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  galleryFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  packageSha256: z.string().regex(/^[a-f0-9]{64}$/),
  packageSize: z.number().int().positive().max(50 * 1024 * 1024),
  permissions: z.array(z.string()).max(200),
  hostPermissions: z.array(z.string()).max(400),
  downloadPath: z.string().startsWith("/").max(1_024),
  rollout: z.object({
    percentage: z.number().int().min(1).max(100),
    seed: z.string().min(16).max(128),
  }).strict().optional(),
}).strict();

export const ExtensionGalleryCatalogSchema = z.object({
  catalogVersion: z.literal(extensionGalleryCatalogVersion),
  packageContractVersion: z.literal(locusxContractVersion),
  extensions: z.array(ExtensionGalleryEntrySchema).max(500),
}).strict().superRefine((catalog, context) => {
  const ids = new Set<string>();
  for (const extension of catalog.extensions) {
    if (ids.has(extension.id)) context.addIssue({ code: "custom", message: `Duplicate gallery extension ID: ${extension.id}` });
    ids.add(extension.id);
    if (extension.downloadPath !== extensionGalleryDownloadPath(extension.id, extension.version)) {
      context.addIssue({ code: "custom", message: `Unexpected download path for ${extension.id}` });
    }
  }
});

export const ExtensionRevocationSchema = z.object({
  id: z.string().regex(/^[a-z0-9](?:[a-z0-9.-]{1,126}[a-z0-9])?$/),
  extensionId: z.string().regex(/^[a-z0-9](?:[a-z0-9.-]{1,126}[a-z0-9])?$/),
  version: z.string().regex(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/).optional(),
  packageSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  publisherFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  reason: z.enum(["malware", "policy", "publisher-key", "security", "takedown"]),
  effectiveAt: z.number().int().nonnegative(),
}).strict();

export const ExtensionRevocationDocumentSchema = z.object({
  version: z.literal(1),
  generatedAt: z.number().int().nonnegative(),
  revocations: z.array(ExtensionRevocationSchema).max(10_000),
}).strict().superRefine((document, context) => {
  const ids = new Set<string>();
  for (const revocation of document.revocations) {
    if (ids.has(revocation.id)) context.addIssue({ code: "custom", message: `Duplicate revocation ID: ${revocation.id}` });
    ids.add(revocation.id);
  }
});

const GalleryDocumentSignatureSchema = z.object({
  algorithm: z.literal("Ed25519"),
  publicKeyPem: z.string().min(1).max(8_192),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  value: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/).max(512),
}).strict();

export const SignedExtensionGalleryCatalogSchema = z.object({
  documentVersion: z.literal(extensionGalleryDocumentVersion),
  kind: z.literal("catalog"),
  payload: ExtensionGalleryCatalogSchema,
  signature: GalleryDocumentSignatureSchema,
}).strict();

export const SignedExtensionRevocationsSchema = z.object({
  documentVersion: z.literal(extensionGalleryDocumentVersion),
  kind: z.literal("revocations"),
  payload: ExtensionRevocationDocumentSchema,
  signature: GalleryDocumentSignatureSchema,
}).strict();

export type ExtensionGalleryEntry = z.infer<typeof ExtensionGalleryEntrySchema>;
export type ExtensionGalleryCatalog = z.infer<typeof ExtensionGalleryCatalogSchema>;
export type ExtensionRevocation = z.infer<typeof ExtensionRevocationSchema>;
export type ExtensionRevocationDocument = z.infer<typeof ExtensionRevocationDocumentSchema>;
export type SignedExtensionGalleryCatalog = z.infer<typeof SignedExtensionGalleryCatalogSchema>;
export type SignedExtensionRevocations = z.infer<typeof SignedExtensionRevocationsSchema>;

export function extensionGalleryDownloadPath(extensionId: string, version: string): string {
  return `/v1/extensions/${encodeURIComponent(extensionId)}/${encodeURIComponent(version)}/download`;
}

export function extensionGalleryDocumentMessage(kind: "catalog" | "revocations", payload: unknown): Uint8Array {
  return Buffer.from(`locus-gallery-document-v${extensionGalleryDocumentVersion}:${kind}:${canonicalJson(payload)}`, "utf8");
}

export function verifySignedExtensionCatalog(raw: unknown, trustedFingerprints: ReadonlySet<string>): ExtensionGalleryCatalog {
  const document = SignedExtensionGalleryCatalogSchema.parse(raw);
  verifyGalleryDocumentSignature(document.kind, document.payload, document.signature, trustedFingerprints);
  return document.payload;
}

export function verifySignedExtensionRevocations(raw: unknown, trustedFingerprints: ReadonlySet<string>): ExtensionRevocationDocument {
  const document = SignedExtensionRevocationsSchema.parse(raw);
  verifyGalleryDocumentSignature(document.kind, document.payload, document.signature, trustedFingerprints);
  return document.payload;
}

export function extensionIsRevoked(
  extension: Pick<ExtensionGalleryEntry, "id" | "version" | "packageSha256" | "publisherFingerprint">,
  revocations: readonly ExtensionRevocation[],
  now = Math.floor(Date.now() / 1_000),
): ExtensionRevocation | undefined {
  return revocations.find((revocation) => revocation.effectiveAt <= now
    && revocation.extensionId === extension.id
    && (!revocation.version || revocation.version === extension.version)
    && (!revocation.packageSha256 || revocation.packageSha256 === extension.packageSha256)
    && (!revocation.publisherFingerprint || revocation.publisherFingerprint === extension.publisherFingerprint));
}

export function compareExtensionVersions(left: string, right: string): number {
  const [leftRelease, leftPrerelease] = left.split("+", 1)[0]!.split("-", 2);
  const [rightRelease, rightPrerelease] = right.split("+", 1)[0]!.split("-", 2);
  const leftParts = leftRelease!.split(".").map(Number);
  const rightParts = rightRelease!.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference) return Math.sign(difference);
  }
  if (leftPrerelease === rightPrerelease) return 0;
  if (leftPrerelease === undefined) return 1;
  if (rightPrerelease === undefined) return -1;
  return leftPrerelease.localeCompare(rightPrerelease, undefined, { numeric: true });
}

function verifyGalleryDocumentSignature(
  kind: "catalog" | "revocations",
  payload: unknown,
  signature: z.infer<typeof GalleryDocumentSignatureSchema>,
  trustedFingerprints: ReadonlySet<string>,
): void {
  const actualFingerprint = publicKeyFingerprint(signature.publicKeyPem);
  if (signature.fingerprint !== actualFingerprint) throw new Error("Gallery document signer fingerprint does not match its public key");
  if (!trustedFingerprints.has(actualFingerprint)) throw new Error("Gallery document signing key is not trusted");
  if (!verify(null, extensionGalleryDocumentMessage(kind, payload), signature.publicKeyPem, Buffer.from(signature.value, "base64"))) {
    throw new Error(`Invalid signed gallery ${kind} document`);
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`;
}
