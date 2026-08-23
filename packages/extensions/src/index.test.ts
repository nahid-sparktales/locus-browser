import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { extensionContentScriptMatches, permissionExpansion, validateExtensionFile, validateManifest, verifyLocusx } from "./index.js";

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
