import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { permissionExpansion, validateManifest, verifyLocusx } from "./index.js";

describe("Locus extension contract", () => {
  it("rejects unsupported manifest keys and permissions", () => {
    expect(() => validateManifest({ manifest_version: 3, name: "Bad", version: "1.0.0", mystery: true })).toThrow("Unsupported manifest keys");
    expect(() => validateManifest({ manifest_version: 3, name: "Bad", version: "1.0.0", permissions: ["cookies"] })).toThrow("Unsupported extension permissions");
  });

  it("detects permission expansion", () => {
    const previous = validateManifest({ manifest_version: 3, name: "One", version: "1.0.0", permissions: ["storage"] });
    const next = validateManifest({ manifest_version: 3, name: "One", version: "1.1.0", permissions: ["storage", "history"] });
    expect(permissionExpansion(previous, next)).toEqual(["history"]);
  });

  it("verifies both signatures and every inventoried file", () => {
    const manifest = strToU8(JSON.stringify({ manifest_version: 3, name: "Notes", version: "1.0.0", permissions: ["storage"] }));
    const script = strToU8("chrome.runtime.onInstalled.addListener(() => {});");
    const inventory = strToU8(JSON.stringify({ files: [
      { path: "manifest.json", sha256: digest(manifest), size: manifest.byteLength },
      { path: "worker.js", sha256: digest(script), size: script.byteLength },
    ] }));
    const publisher = generateKeyPairSync("ed25519");
    const gallery = generateKeyPairSync("ed25519");
    const message = Buffer.from(`${digest(manifest)}:${digest(inventory)}`);
    const signatures = strToU8(JSON.stringify({
      publisher: { publicKeyPem: publisher.publicKey.export({ format: "pem", type: "spki" }).toString(), signature: sign(null, message, publisher.privateKey).toString("base64") },
      gallery: { publicKeyPem: gallery.publicKey.export({ format: "pem", type: "spki" }).toString(), signature: sign(null, message, gallery.privateKey).toString("base64") },
    }));
    const galleryPem = gallery.publicKey.export({ format: "pem", type: "spki" }).toString();
    const trusted = new Set([digest(Buffer.from(galleryPem.replace(/\s+/g, "")))]);
    const verified = verifyLocusx(zipSync({ "manifest.json": manifest, "worker.js": script, "inventory.json": inventory, "signatures.json": signatures }), trusted);
    expect(verified.manifest.name).toBe("Notes");
    expect(verified.files.has("worker.js")).toBe(true);
  });
});

function digest(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
