import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BrowserDatabase } from "./BrowserDatabase.js";
import { ExtensionManager, type ExtensionRuntime, type LoadedExtension } from "./ExtensionManager.js";
import { GalleryExtensionStore } from "./GalleryExtensionStore.js";
import { writeSignedExtensionFixture } from "./SignedExtensionTestFixture.js";

class FakeExtensionRuntime implements ExtensionRuntime {
  readonly loaded = new Map<string, LoadedExtension>();
  loadCalls = 0;

  getExtension(id: string): LoadedExtension | null {
    return this.loaded.get(id) ?? null;
  }

  async loadExtension(path: string): Promise<LoadedExtension> {
    this.loadCalls += 1;
    const extension = { id: "runtime-extension", name: "Notes", path, version: "1.0.0" };
    this.loaded.set(extension.id, extension);
    return extension;
  }

  removeExtension(id: string): void {
    this.loaded.delete(id);
  }
}

describe("ExtensionManager", () => {
  it("requires Developer Mode, persists the install, and unloads without deleting user files", async () => {
    const { database, manager, runtime, extensionPath } = fixture();
    const review = await manager.inspectUnpacked(extensionPath);
    await expect(manager.installUnpacked(review)).rejects.toThrow("Developer Mode");

    await manager.setDeveloperMode(true);
    await manager.installUnpacked(review);
    expect(manager.state()).toMatchObject({
      developerMode: true,
      installs: [{
        name: "Notes",
        enabled: true,
        loaded: true,
        source: "developer",
        hostPermissions: ["https://example.com/*"],
      }],
    });

    const id = manager.state().installs[0]!.id;
    await manager.setEnabled(id, false);
    expect(manager.state().installs[0]).toMatchObject({ enabled: false, loaded: false });
    expect(runtime.loaded.size).toBe(0);
    await manager.remove(id);
    expect(manager.state().installs).toEqual([]);
    expect(existsSync(extensionPath)).toBe(true);
    database.close();
  });

  it("restores enabled extensions only while Developer Mode is on", async () => {
    const { database, manager, runtime, extensionPath } = fixture();
    await manager.setDeveloperMode(true);
    await manager.installUnpacked(await manager.inspectUnpacked(extensionPath));
    await manager.setDeveloperMode(false);
    expect(runtime.loaded.size).toBe(0);
    await manager.initialize();
    expect(runtime.loadCalls).toBe(1);
    await manager.setDeveloperMode(true);
    expect(runtime.loadCalls).toBe(2);
    expect(manager.state().installs[0]?.loaded).toBe(true);
    database.close();
  });

  it("blocks startup when an unpacked extension silently expands permissions", async () => {
    const { database, manager, runtime, extensionPath } = fixture();
    await manager.setDeveloperMode(true);
    await manager.installUnpacked(await manager.inspectUnpacked(extensionPath));
    runtime.loaded.clear();
    writeManifest(extensionPath, ["storage", "tabs"]);

    await manager.initialize();
    expect(runtime.loadCalls).toBe(1);
    expect(manager.state().installs[0]).toMatchObject({ loaded: false, error: "New permissions require review: tabs" });
    database.close();
  });

  it("rejects extension files changed after the permission review", async () => {
    const { database, manager, extensionPath } = fixture();
    await manager.setDeveloperMode(true);
    const review = await manager.inspectUnpacked(extensionPath);
    writeFileSync(join(extensionPath, "worker.js"), "document.documentElement.dataset.changed = 'true';");

    await expect(manager.installUnpacked(review)).rejects.toThrow("changed while permissions were being reviewed");
    expect(manager.state().installs).toEqual([]);
    database.close();
  });

  it("installs, updates, rolls back, and removes trusted gallery packages", async () => {
    const root = mkdtempSync(join(tmpdir(), "locus-gallery-manager-"));
    const database = new BrowserDatabase(join(root, "browser.sqlite"));
    const runtime = new FakeExtensionRuntime();
    const gallery = generateKeyPairSync("ed25519");
    const publisher = generateKeyPairSync("ed25519");
    const firstPackage = join(root, "notes-1.0.0.locusx");
    const fingerprint = writeSignedExtensionFixture(firstPackage, { gallery, publisher });
    const store = new GalleryExtensionStore(join(root, "managed"), new Set([fingerprint]));
    const manager = new ExtensionManager(database, "default", runtime, store);

    const firstReview = await manager.inspectGallery(firstPackage);
    await manager.installGallery(firstReview);
    expect(manager.state()).toMatchObject({
      trustedGalleryKeyCount: 1,
      installs: [{ source: "gallery", version: "1.0.0", loaded: true, galleryKeyName: "Trusted Locus gallery" }],
    });
    const loadCallsAfterFirstInstall = runtime.loadCalls;
    await manager.installGallery(await manager.inspectGallery(firstPackage));
    expect(runtime.loadCalls).toBe(loadCallsAfterFirstInstall + 1);

    const updatePackage = join(root, "notes-1.1.0.locusx");
    writeSignedExtensionFixture(updatePackage, {
      gallery,
      publisher,
      manifest: { ...firstReview.inspection.manifest, version: "1.1.0" },
    });
    await manager.installGallery(await manager.inspectGallery(updatePackage));
    expect(manager.state().installs[0]).toMatchObject({ version: "1.1.0", rollbackVersion: "1.0.0", loaded: true });

    const rollbackReview = await manager.prepareRollback("dev.locus.reading-notes");
    await manager.rollback("dev.locus.reading-notes", rollbackReview);
    expect(manager.state().installs[0]).toMatchObject({ version: "1.0.0", rollbackVersion: "1.1.0", loaded: true });

    const installedPaths = database.listExtensionPackages("default", "dev.locus.reading-notes").map((item) => item.installPath);
    await manager.remove("dev.locus.reading-notes");
    expect(manager.state().installs).toEqual([]);
    expect(installedPaths.every((path) => !existsSync(path))).toBe(true);
    database.close();
  });

  it("rejects a gallery update that changes the verified publisher", async () => {
    const root = mkdtempSync(join(tmpdir(), "locus-gallery-publisher-"));
    const database = new BrowserDatabase(join(root, "browser.sqlite"));
    const runtime = new FakeExtensionRuntime();
    const gallery = generateKeyPairSync("ed25519");
    const publisher = generateKeyPairSync("ed25519");
    const replacementPublisher = generateKeyPairSync("ed25519");
    const firstPackage = join(root, "notes-1.0.0.locusx");
    const fingerprint = writeSignedExtensionFixture(firstPackage, { gallery, publisher });
    const manager = new ExtensionManager(
      database,
      "default",
      runtime,
      new GalleryExtensionStore(join(root, "managed"), new Set([fingerprint])),
    );
    const firstReview = await manager.inspectGallery(firstPackage);
    await manager.installGallery(firstReview);

    const updatePackage = join(root, "notes-1.1.0.locusx");
    writeSignedExtensionFixture(updatePackage, {
      gallery,
      publisher: replacementPublisher,
      manifest: { ...firstReview.inspection.manifest, version: "1.1.0" },
    });
    await expect(manager.installGallery(await manager.inspectGallery(updatePackage))).rejects.toThrow("same verified publisher");
    expect(manager.state().installs[0]?.version).toBe("1.0.0");
    database.close();
  });
});

function fixture(): { database: BrowserDatabase; manager: ExtensionManager; runtime: FakeExtensionRuntime; extensionPath: string } {
  const root = mkdtempSync(join(tmpdir(), "locus-extension-manager-"));
  const extensionPath = join(root, "extension");
  const database = new BrowserDatabase(join(root, "browser.sqlite"));
  const runtime = new FakeExtensionRuntime();
  writeManifest(extensionPath, ["storage"]);
  writeFileSync(join(extensionPath, "worker.js"), "chrome.runtime.onInstalled.addListener(() => {});");
  return { database, manager: new ExtensionManager(database, "default", runtime), runtime, extensionPath };
}

function writeManifest(path: string, permissions: string[]): void {
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, "manifest.json"), JSON.stringify({
    manifest_version: 3,
    name: "Notes",
    version: "1.0.0",
    permissions,
    content_scripts: [{ matches: ["https://example.com/*"], js: ["worker.js"] }],
  }));
}
