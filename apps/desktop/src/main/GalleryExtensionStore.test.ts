import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GalleryExtensionStore } from "./GalleryExtensionStore.js";
import { writeSignedExtensionFixture } from "./SignedExtensionTestFixture.js";

describe("GalleryExtensionStore", () => {
  it("verifies and atomically extracts a package signed by a trusted gallery", async () => {
    const root = mkdtempSync(join(tmpdir(), "locus-gallery-store-"));
    const packagePath = join(root, "reading-notes.locusx");
    const gallery = generateKeyPairSync("ed25519");
    const publisher = generateKeyPairSync("ed25519");
    const fingerprint = writeSignedExtensionFixture(packagePath, { gallery, publisher });
    const store = new GalleryExtensionStore(join(root, "managed"), new Set([fingerprint]));

    const review = await store.inspect(packagePath);
    expect(review).toMatchObject({ id: "dev.locus.reading-notes", fileCount: 2, manifest: { version: "1.0.0" } });
    const installed = await store.install(review);
    expect(readFileSync(join(installed.installPath, "content.js"), "utf8")).toContain("locusSignedExtension");
    expect(existsSync(join(installed.installPath, "inventory.json"))).toBe(false);
    expect((await store.install(review)).installPath).toBe(installed.installPath);

    writeFileSync(join(installed.installPath, "content.js"), "tampered");
    await expect(store.install(review)).rejects.toThrow("integrity check");

    await store.removeManagedVersion(installed.installPath);
    await store.removeManagedVersion(installed.installPath);
    expect(existsSync(installed.installPath)).toBe(false);
  });

  it("rejects untrusted gallery keys and packages changed after review", async () => {
    const root = mkdtempSync(join(tmpdir(), "locus-gallery-review-"));
    const packagePath = join(root, "reading-notes.locusx");
    const gallery = generateKeyPairSync("ed25519");
    const publisher = generateKeyPairSync("ed25519");
    const fingerprint = writeSignedExtensionFixture(packagePath, { gallery, publisher });
    const untrustedStore = new GalleryExtensionStore(join(root, "untrusted"), new Set());
    await expect(untrustedStore.inspect(packagePath)).rejects.toThrow("Gallery signing key is not trusted");

    const store = new GalleryExtensionStore(join(root, "managed"), new Set([fingerprint]));
    const review = await store.inspect(packagePath);
    writeSignedExtensionFixture(packagePath, {
      gallery,
      publisher,
      manifest: { ...review.manifest, version: "1.1.0" },
    });
    await expect(store.install(review)).rejects.toThrow("changed while permissions were being reviewed");
  });
});
