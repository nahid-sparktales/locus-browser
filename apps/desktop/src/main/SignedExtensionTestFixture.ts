import { createHash, sign, type KeyObject } from "node:crypto";
import { writeFileSync } from "node:fs";
import {
  locusxContractVersion,
  locusxGalleryMessage,
  locusxPublisherMessage,
  publicKeyFingerprint,
  type LocusExtensionManifest,
} from "@locus/extensions";
import { strToU8, zipSync } from "fflate";

export interface SignedExtensionFixtureOptions {
  gallery: { publicKey: KeyObject; privateKey: KeyObject };
  publisher: { publicKey: KeyObject; privateKey: KeyObject };
  extensionId?: string;
  manifest?: LocusExtensionManifest;
  files?: Record<string, Uint8Array>;
}

export function writeSignedExtensionFixture(path: string, options: SignedExtensionFixtureOptions): string {
  const extensionId = options.extensionId ?? "dev.locus.reading-notes";
  const manifest = {
    ...(options.manifest ?? {
    manifest_version: 3,
    name: "Reading Notes",
    version: "1.0.0",
    description: "A signed Locus extension fixture.",
    permissions: ["storage"],
    host_permissions: ["https://example.com/*"],
    optional_permissions: [],
    optional_host_permissions: [],
    content_scripts: [{ matches: ["https://example.com/*"], js: ["content.js"] }],
    }),
    key: options.publisher.publicKey.export({ format: "der", type: "spki" }).toString("base64"),
  } satisfies LocusExtensionManifest;
  const manifestBytes = strToU8(JSON.stringify(manifest));
  const files = options.files ?? { "content.js": strToU8("document.documentElement.dataset.locusSignedExtension = 'active';") };
  const extensionFiles = { "manifest.json": manifestBytes, ...files };
  const inventoryBytes = strToU8(JSON.stringify({
    files: Object.entries(extensionFiles).map(([filePath, bytes]) => ({
      path: filePath,
      sha256: digest(bytes),
      size: bytes.byteLength,
    })),
  }));
  const publisherPem = options.publisher.publicKey.export({ format: "pem", type: "spki" }).toString();
  const galleryPem = options.gallery.publicKey.export({ format: "pem", type: "spki" }).toString();
  const publisherMessage = locusxPublisherMessage(extensionId, manifestBytes, inventoryBytes);
  const publisherSignature = sign(null, publisherMessage, options.publisher.privateKey);
  const galleryMessage = locusxGalleryMessage(publisherMessage, publicKeyFingerprint(publisherPem), publisherSignature);
  const signaturesBytes = strToU8(JSON.stringify({
    contractVersion: locusxContractVersion,
    extensionId,
    publisher: { publicKeyPem: publisherPem, signature: publisherSignature.toString("base64") },
    gallery: { publicKeyPem: galleryPem, signature: sign(null, galleryMessage, options.gallery.privateKey).toString("base64") },
  }));
  writeFileSync(path, zipSync({ ...extensionFiles, "inventory.json": inventoryBytes, "signatures.json": signaturesBytes }));
  return publicKeyFingerprint(galleryPem);
}

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
