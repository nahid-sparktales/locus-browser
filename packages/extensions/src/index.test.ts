import { createHash, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  extensionContentScriptMatches,
  locusxContractVersion,
  locusxGalleryMessage,
  locusxPublisherMessage,
  permissionExpansion,
  publicKeyFingerprint,
  validateExtensionFile,
  validateManifest,
  verifyLocusx,
} from "./index.js";

describe("Locus extension contract", () => {
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
});

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
