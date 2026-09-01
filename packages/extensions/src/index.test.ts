import { createHash, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import * as extensionsApi from "./index.js";
import {
  extensionContentScriptMatches,
  ExtensionGalleryCatalogSchema,
  extensionGalleryDocumentMessage,
  extensionGalleryDownloadPath,
  extensionIsRevoked,
  locusxContractVersion,
  locusxGalleryMessage,
  locusxPublisherMessage,
  permissionExpansion,
  publicKeyFingerprint,
  validateExtensionFile,
  validateManifest,
  verifyLocusx,
  verifySignedExtensionCatalog,
  verifySignedExtensionRevocations,
} from "./index.js";

describe("Locus extension contract", () => {
  it("preserves the public runtime export contract", () => {
    expect(Object.keys(extensionsApi).sort()).toEqual([
      "ExtensionGalleryCatalogSchema", "ExtensionGalleryEntrySchema",
      "ExtensionRevocationDocumentSchema", "ExtensionRevocationSchema",
      "SignedExtensionGalleryCatalogSchema", "SignedExtensionRevocationsSchema",
      "capabilityRegistry", "compareExtensionVersions", "extensionContentScriptMatches",
      "extensionGalleryCatalogVersion", "extensionGalleryDocumentMessage",
      "extensionGalleryDocumentVersion", "extensionGalleryDownloadPath", "extensionIsRevoked",
      "extensionLocalResources", "locusxContractVersion", "locusxGalleryMessage",
      "locusxPublisherMessage", "permissionExpansion", "publicKeyFingerprint",
      "trustedGalleryFingerprints", "trustedGalleryKeys", "validateExtensionFile",
      "validateManifest", "verifyLocusx", "verifySignedExtensionCatalog",
      "verifySignedExtensionRevocations",
    ].sort());
  });

  it("rejects unsupported manifest keys and permissions", () => {
    expect(() => validateManifest({ manifest_version: 3, name: "Bad", version: "1.0.0", mystery: true })).toThrow("Unsupported manifest keys");
    expect(() => validateManifest({ manifest_version: 3, name: "Bad", version: "1.0.0", permissions: ["cookies"] })).toThrow("Unsupported extension permissions");
    expect(() => validateManifest({ manifest_version: 3, name: "Not Yet", version: "1.0.0", permissions: ["contextMenus"] })).toThrow("Unsupported extension permissions");
  });

  it("detects permission expansion", () => {
    const previous = validateManifest({
      manifest_version: 3, name: "One", version: "1.0.0", permissions: ["storage"],
      content_scripts: [{ matches: ["https://example.com/*"], js: ["worker.js"] }],
    });
    const next = validateManifest({
      manifest_version: 3, name: "One", version: "1.1.0", permissions: ["storage", "tabs"],
      content_scripts: [{ matches: ["https://example.com/*", "https://docs.example/*"], js: ["worker.js"] }],
    });
    expect(extensionContentScriptMatches(next)).toEqual(["https://example.com/*", "https://docs.example/*"]);
    expect(permissionExpansion(previous, next)).toEqual(["tabs", "https://docs.example/*"]);
  });

  it("validates deterministic gallery download paths", () => {
    const id = "dev.locus.notes";
    const version = "1.2.0";
    expect(extensionGalleryDownloadPath(id, version)).toBe("/v1/extensions/dev.locus.notes/1.2.0/download");
    expect(ExtensionGalleryCatalogSchema.safeParse({
      catalogVersion: 1,
      packageContractVersion: 2,
      extensions: [{
        id,
        name: "Notes",
        version,
        publisherFingerprint: "a".repeat(64),
        galleryFingerprint: "b".repeat(64),
        packageSha256: "c".repeat(64),
        packageSize: 100,
        permissions: ["storage"],
        hostPermissions: ["https://example.com/*"],
        downloadPath: extensionGalleryDownloadPath(id, version),
      }],
    }).success).toBe(true);
  });

  it("verifies signed catalog and revocation documents and rejects tampering", () => {
    const key = generateKeyPairSync("ed25519");
    const publicKeyPem = key.publicKey.export({ format: "pem", type: "spki" }).toString();
    const fingerprint = publicKeyFingerprint(publicKeyPem);
    const catalog = ExtensionGalleryCatalogSchema.parse({
      catalogVersion: 1,
      packageContractVersion: 2,
      extensions: [{
        id: "dev.locus.notes", name: "Notes", version: "1.2.0",
        publisherFingerprint: "a".repeat(64), galleryFingerprint: fingerprint,
        packageSha256: "c".repeat(64), packageSize: 100, permissions: ["storage"],
        hostPermissions: [], downloadPath: extensionGalleryDownloadPath("dev.locus.notes", "1.2.0"),
        rollout: { percentage: 25, seed: "canary-rollout-seed" },
      }],
    });
    const signedCatalog = signedDocument("catalog", catalog, key, publicKeyPem, fingerprint);
    expect(verifySignedExtensionCatalog(signedCatalog, new Set([fingerprint]))).toEqual(catalog);
    expect(() => verifySignedExtensionCatalog({
      ...signedCatalog,
      payload: { ...catalog, packageContractVersion: 99 },
    }, new Set([fingerprint]))).toThrow();

    const revocations = {
      version: 1 as const,
      generatedAt: 1_787_408_000,
      revocations: [{
        id: "notes-security-1", extensionId: "dev.locus.notes", version: "1.2.0",
        reason: "security" as const, effectiveAt: 1_787_408_000,
      }],
    };
    const signedRevocations = signedDocument("revocations", revocations, key, publicKeyPem, fingerprint);
    const verified = verifySignedExtensionRevocations(signedRevocations, new Set([fingerprint]));
    expect(extensionIsRevoked(catalog.extensions[0]!, verified.revocations, 1_787_408_001)?.reason).toBe("security");
    expect(extensionIsRevoked(catalog.extensions[0]!, verified.revocations, 1_787_407_999)).toBeUndefined();
  });

  it("rejects remote or escaping content-script resources", () => {
    expect(() => validateManifest({
      manifest_version: 3, name: "Remote", version: "1.0.0",
      content_scripts: [{ matches: ["https://example.com/*"], js: ["https://cdn.example/worker.js"] }],
    })).toThrow("Unsafe extension resource path");
    expect(() => validateManifest({
      manifest_version: 3, name: "Escape", version: "1.0.0",
      content_scripts: [{ matches: ["https://example.com/*"], js: ["../worker.js"] }],
    })).toThrow("Unsafe extension resource path");
  });

  it("verifies both signatures and every inventoried file", () => {
    const publisher = generateKeyPairSync("ed25519");
    const gallery = generateKeyPairSync("ed25519");
    const publisherManifestKey = publisher.publicKey.export({ format: "der", type: "spki" }).toString("base64");
    const { archive, trusted } = signedArchive({
      manifest_version: 3,
      name: "Notes",
      version: "1.0.0",
      permissions: ["storage"],
      key: publisherManifestKey,
    }, publisher, gallery);
    const verified = verifyLocusx(archive, trusted);
    expect(verified.id).toBe("dev.locus.notes");
    expect(verified.manifest.name).toBe("Notes");
    expect(verified.files.has("worker.js")).toBe(true);
  });

  it("rejects a validly signed package whose manifest key is not bound to its publisher", () => {
    const publisher = generateKeyPairSync("ed25519");
    const gallery = generateKeyPairSync("ed25519");
    const { archive, trusted } = signedArchive({
      manifest_version: 3,
      name: "Unbound",
      version: "1.0.0",
      permissions: ["storage"],
    }, publisher, gallery);
    expect(() => verifyLocusx(archive, trusted)).toThrow("manifest key must match");
  });

  it("rejects remote scripts and dynamic code in unpacked extension files", () => {
    expect(() => validateExtensionFile("popup.html", strToU8('<script src="https://cdn.example/worker"></script>'))).toThrow("Remote executable code");
    expect(() => validateExtensionFile("worker.js", strToU8('import("https://cdn.example/worker.js")'))).toThrow("Remote executable code");
    expect(() => validateExtensionFile("worker.js", strToU8('new Function("return 1")'))).toThrow("Dynamic code execution");
    expect(() => validateExtensionFile("worker.js", strToU8('chrome.runtime.onInstalled.addListener(() => {})'))).not.toThrow();
  });

  it("fails closed on deterministic archive fuzz without accepting random bytes", () => {
    let state = 0x1a2b3c4d;
    for (let size = 0; size < 200; size += 1) {
      const bytes = new Uint8Array(size);
      for (let index = 0; index < bytes.length; index += 1) {
        state = (Math.imul(state, 1_103_515_245) + 12_345) >>> 0;
        bytes[index] = state & 0xff;
      }
      expect(() => verifyLocusx(bytes, new Set())).toThrow();
    }
  });
});

function signedDocument(
  kind: "catalog" | "revocations",
  payload: unknown,
  key: { publicKey: KeyObject; privateKey: KeyObject },
  publicKeyPem: string,
  fingerprint: string,
) {
  return {
    documentVersion: 1,
    kind,
    payload,
    signature: {
      algorithm: "Ed25519",
      publicKeyPem,
      fingerprint,
      value: sign(null, extensionGalleryDocumentMessage(kind, payload), key.privateKey).toString("base64"),
    },
  };
}

function digest(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function signedArchive(
  manifestValue: Record<string, unknown>,
  publisher: { publicKey: KeyObject; privateKey: KeyObject },
  gallery: { publicKey: KeyObject; privateKey: KeyObject },
): { archive: Uint8Array; trusted: Set<string> } {
  const manifest = strToU8(JSON.stringify(manifestValue));
  const script = strToU8("chrome.runtime.onInstalled.addListener(() => {});");
  const inventory = strToU8(JSON.stringify({ files: [
    { path: "manifest.json", sha256: digest(manifest), size: manifest.byteLength },
    { path: "worker.js", sha256: digest(script), size: script.byteLength },
  ] }));
  const publisherMessage = locusxPublisherMessage("dev.locus.notes", manifest, inventory);
  const publisherSignature = sign(null, publisherMessage, publisher.privateKey);
  const publisherPem = publisher.publicKey.export({ format: "pem", type: "spki" }).toString();
  const galleryPem = gallery.publicKey.export({ format: "pem", type: "spki" }).toString();
  const galleryMessage = locusxGalleryMessage(publisherMessage, publicKeyFingerprint(publisherPem), publisherSignature);
  const signatures = strToU8(JSON.stringify({
    contractVersion: locusxContractVersion,
    extensionId: "dev.locus.notes",
    publisher: { publicKeyPem: publisherPem, signature: publisherSignature.toString("base64") },
    gallery: { publicKeyPem: galleryPem, signature: sign(null, galleryMessage, gallery.privateKey).toString("base64") },
  }));
  return {
    archive: zipSync({ "manifest.json": manifest, "worker.js": script, "inventory.json": inventory, "signatures.json": signatures }),
    trusted: new Set([publicKeyFingerprint(galleryPem)]),
  };
}
