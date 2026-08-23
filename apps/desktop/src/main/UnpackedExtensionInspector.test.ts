import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { inspectUnpackedExtension } from "./UnpackedExtensionInspector.js";

describe("unpacked extension inspection", () => {
  it("validates and fingerprints a bounded local MV3 extension", async () => {
    const root = mkdtempSync(join(tmpdir(), "locus-unpacked-extension-"));
    writeFileSync(join(root, "manifest.json"), JSON.stringify({
      manifest_version: 3,
      name: "Reading Notes",
      version: "1.0.0",
      permissions: ["storage"],
      host_permissions: ["https://example.com/*"],
      content_scripts: [{ matches: ["https://example.com/*"], js: ["worker.js"] }],
    }));
    writeFileSync(join(root, "worker.js"), "chrome.runtime.onInstalled.addListener(() => {});");

    const result = await inspectUnpackedExtension(root);
    expect(result.manifest).toMatchObject({ name: "Reading Notes", version: "1.0.0" });
    expect(result.fileCount).toBe(2);
    expect(result.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects remote code and linked files before Electron sees the folder", async () => {
    const remote = mkdtempSync(join(tmpdir(), "locus-unpacked-remote-"));
    writeFileSync(join(remote, "manifest.json"), JSON.stringify({ manifest_version: 3, name: "Remote", version: "1.0.0" }));
    writeFileSync(join(remote, "popup.html"), '<script src="https://cdn.example/worker"></script>');
    await expect(inspectUnpackedExtension(remote)).rejects.toThrow("Remote executable code");

    const linked = mkdtempSync(join(tmpdir(), "locus-unpacked-linked-"));
    mkdirSync(join(linked, "scripts"));
    writeFileSync(join(linked, "manifest.json"), JSON.stringify({ manifest_version: 3, name: "Linked", version: "1.0.0" }));
    symlinkSync(join(remote, "popup.html"), join(linked, "scripts", "worker.js"));
    await expect(inspectUnpackedExtension(linked)).rejects.toThrow("Linked extension files are forbidden");
  });

  it("rejects unsupported permissions and manifest keys", async () => {
    const root = mkdtempSync(join(tmpdir(), "locus-unpacked-contract-"));
    writeFileSync(join(root, "manifest.json"), JSON.stringify({
      manifest_version: 3,
      name: "Cookies",
      version: "1.0.0",
      permissions: ["cookies"],
    }));
    await expect(inspectUnpackedExtension(root)).rejects.toThrow("Unsupported extension permissions");
  });

  it("rejects manifest resources that are absent from the folder", async () => {
    const root = mkdtempSync(join(tmpdir(), "locus-unpacked-missing-"));
    writeFileSync(join(root, "manifest.json"), JSON.stringify({
      manifest_version: 3,
      name: "Missing",
      version: "1.0.0",
      content_scripts: [{ matches: ["https://example.com/*"], js: ["missing.js"] }],
    }));
    await expect(inspectUnpackedExtension(root)).rejects.toThrow("Extension resource is missing: missing.js");
  });
});
