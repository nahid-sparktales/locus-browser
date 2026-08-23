import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { BrowserDatabase } from "./BrowserDatabase.js";

describe("BrowserDatabase", () => {
  it("round-trips window and tab restoration state", () => {
    const database = new BrowserDatabase(join(mkdtempSync(join(tmpdir(), "locus-browser-")), "browser.sqlite"));
    database.saveWindow({
      id: "main",
      profileId: "default",
      sidebarOpen: true,
      workOpen: false,
      workWidth: 420,
    }, [{
      id: "tab-1",
      windowId: "main",
      profileId: "default",
      position: 0,
      url: "https://example.com",
      title: "Example",
      active: true,
      muted: false,
      pinned: false,
      private: false,
    }]);

    expect(database.loadWindow("main")?.sidebarOpen).toBe(1);
    expect(database.loadTabs("main")[0]?.url).toBe("https://example.com");
    database.close();
  });

  it("stores browser library records and tombstones removed bookmarks", () => {
    const database = new BrowserDatabase(join(mkdtempSync(join(tmpdir(), "locus-library-")), "browser.sqlite"));

    database.recordVisit("default", "tab-1", "https://example.com/docs", "Example Docs");
    expect(database.listHistory("default")).toMatchObject([
      { title: "Example Docs", url: "https://example.com/docs" },
    ]);

    const bookmarkId = database.addBookmark("default", "Example", "https://example.com");
    expect(database.bookmarkForUrl("default", "https://example.com")?.id).toBe(bookmarkId);
    expect(database.listBookmarks("default")).toHaveLength(1);
    database.removeBookmark("default", bookmarkId);
    expect(database.listBookmarks("default")).toEqual([]);
    expect(database.bookmarkForUrl("default", "https://example.com")).toBeUndefined();

    database.close();
  });

  it("updates download progress without replacing its identity", () => {
    const database = new BrowserDatabase(join(mkdtempSync(join(tmpdir(), "locus-download-")), "browser.sqlite"));
    database.saveDownload("default", {
      id: "download-1",
      tabId: "tab-1",
      filename: "report.pdf",
      url: "https://example.com/report.pdf",
      path: "/tmp/report.pdf",
      state: "progressing",
      receivedBytes: 512,
      totalBytes: 1_024,
      agentInitiated: false,
      startedAt: 123,
    });
    database.saveDownload("default", {
      id: "download-1",
      tabId: "tab-1",
      filename: "report.pdf",
      url: "https://example.com/report.pdf",
      path: "/tmp/report.pdf",
      state: "completed",
      receivedBytes: 1_024,
      totalBytes: 1_024,
      agentInitiated: false,
      startedAt: 123,
      finishedAt: 124,
    });

    expect(database.listDownloads("default")).toMatchObject([{
      id: "download-1",
      filename: "report.pdf",
      state: "completed",
      receivedBytes: 1_024,
      finishedAt: 124,
    }]);
    database.close();
  });

  it("isolates profile libraries and persists profile settings and permissions", () => {
    const database = new BrowserDatabase(join(mkdtempSync(join(tmpdir(), "locus-profiles-")), "browser.sqlite"));
    const work = database.createProfile("Work");
    database.recordVisit(work.id, "work-tab", "https://work.example", "Work");
    database.addBookmark(work.id, "Work", "https://work.example");
    database.setSetting(work.id, "searchEngine", "brave");
    database.setSitePermission(work.id, "https://meet.example", "media", "allow");

    expect(database.listHistory("default")).toEqual([]);
    expect(database.listBookmarks("default")).toEqual([]);
    expect(database.listHistory(work.id)).toHaveLength(1);
    expect(database.listBookmarks(work.id)).toHaveLength(1);
    expect(database.setting(work.id, "searchEngine")).toBe("brave");
    expect(database.sitePermission(work.id, "https://meet.example", "media")).toBe("allow");
    database.deleteProfile(work.id);
    expect(database.profile(work.id)).toBeUndefined();
    expect(database.listHistory(work.id)).toEqual([]);
    database.close();
  });

  it("stores profile-scoped extension load metadata", () => {
    const database = new BrowserDatabase(join(mkdtempSync(join(tmpdir(), "locus-extensions-")), "browser.sqlite"));
    const work = database.createProfile("Work");
    database.saveExtensionInstall(work.id, {
      id: "extension-a",
      runtimeId: "runtime-a",
      name: "Workspace Notes",
      version: "1.2.0",
      enabled: true,
      source: "developer",
      installPath: "/tmp/workspace-notes",
      manifestJson: JSON.stringify({ manifest_version: 3, name: "Workspace Notes", version: "1.2.0" }),
    });

    expect(database.listExtensionInstalls("default")).toEqual([]);
    expect(database.listExtensionInstalls(work.id)).toMatchObject([{
      id: "extension-a",
      runtimeId: "runtime-a",
      name: "Workspace Notes",
      enabled: true,
      source: "developer",
    }]);
    database.setExtensionLoadState(work.id, "extension-a", false, undefined, "Disabled for review");
    expect(database.listExtensionInstalls(work.id)[0]).toMatchObject({ enabled: false, lastError: "Disabled for review" });
    database.deleteExtensionInstall(work.id, "extension-a");
    expect(database.listExtensionInstalls(work.id)).toEqual([]);
    database.close();
  });

  it("keeps verified gallery package versions available for rollback", () => {
    const database = new BrowserDatabase(join(mkdtempSync(join(tmpdir(), "locus-extension-packages-")), "browser.sqlite"));
    database.saveExtensionInstall("default", {
      id: "dev.locus.notes",
      name: "Notes",
      version: "1.1.0",
      enabled: true,
      source: "gallery",
      installPath: "/managed/notes/1.1.0",
      manifestJson: JSON.stringify({ manifest_version: 3, name: "Notes", version: "1.1.0" }),
    });
    database.saveExtensionPackage("default", {
      extensionId: "dev.locus.notes",
      version: "1.0.0",
      installPath: "/managed/notes/1.0.0",
      packageFingerprint: "package-v1",
      publisherFingerprint: "publisher",
      galleryFingerprint: "gallery",
      installedAt: 1,
    });
    database.saveExtensionPackage("default", {
      extensionId: "dev.locus.notes",
      version: "1.1.0",
      installPath: "/managed/notes/1.1.0",
      packageFingerprint: "package-v2",
      publisherFingerprint: "publisher",
      galleryFingerprint: "gallery",
      installedAt: 2,
    });

    expect(database.listExtensionPackages("default", "dev.locus.notes").map((item) => item.version)).toEqual(["1.1.0", "1.0.0"]);
    database.deleteExtensionPackages("default", "dev.locus.notes");
    expect(database.listExtensionPackages("default", "dev.locus.notes")).toEqual([]);
    database.close();
  });

  it("round-trips tab groups with their tab membership", () => {
    const database = new BrowserDatabase(join(mkdtempSync(join(tmpdir(), "locus-groups-")), "browser.sqlite"));
    database.saveWindow({ id: "group-window", profileId: "default", sidebarOpen: true, workOpen: false, workWidth: 420 }, [{
      id: "group-tab", windowId: "group-window", profileId: "default", position: 0,
      url: "https://example.com", title: "Example", active: true, muted: false, pinned: false, private: false, groupId: "group-1",
    }], [{
      id: "group-1", windowId: "group-window", profileId: "default", name: "Research", color: "blue", collapsed: true, position: 0,
    }]);

    expect(database.loadTabGroups("group-window")).toMatchObject([{ id: "group-1", name: "Research", collapsed: 1 }]);
    expect(database.loadTabs("group-window")[0]?.groupId).toBe("group-1");
    database.close();
  });

  it("migrates legacy unscoped credentials into the default profile", () => {
    const path = join(mkdtempSync(join(tmpdir(), "locus-credentials-migration-")), "browser.sqlite");
    const legacy = new DatabaseSync(path);
    legacy.exec(`
      CREATE TABLE browser_credentials (
        id TEXT PRIMARY KEY,
        origin TEXT NOT NULL,
        username TEXT NOT NULL,
        encrypted_password BLOB NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX browser_credentials_origin ON browser_credentials(origin);
      INSERT INTO browser_credentials(id, origin, username, encrypted_password, updated_at)
      VALUES ('legacy-login', 'https://example.com', 'person', X'0102', 123);
    `);
    legacy.close();

    const database = new BrowserDatabase(path);
    expect(database.listCredentials("default")).toEqual([{
      id: "legacy-login",
      origin: "https://example.com",
      username: "person",
      updatedAt: 123,
    }]);
    database.close();
  });

  it("queues only the permitted encrypted-sync collections and preserves the outbox across restarts", () => {
    const path = join(mkdtempSync(join(tmpdir(), "locus-sync-outbox-")), "browser.sqlite");
    const database = new BrowserDatabase(path);
    database.saveWindow({ id: "sync-window", profileId: "default", sidebarOpen: false, workOpen: false, workWidth: 420 }, [
      { id: "web", windowId: "sync-window", profileId: "default", position: 0, url: "https://example.com", title: "Example", active: true, muted: false, pinned: false, private: false },
      { id: "local", windowId: "sync-window", profileId: "default", position: 1, url: "file:///secret.txt", title: "Local", active: false, muted: false, pinned: false, private: false },
    ], [{ id: "group", windowId: "sync-window", profileId: "default", name: "Research", color: "blue", collapsed: false, position: 0 }]);
    database.addBookmark("default", "Example", "https://example.com");
    database.recordVisit("default", "web", "https://example.com", "Example");
    database.setSetting("default", "appearance", "dark");
    database.setSetting("default", "downloadDirectory", "/private/downloads");
    database.saveDownload("default", { id: "download", filename: "secret.pdf", url: "https://example.com/secret.pdf", path: "/private/secret.pdf", state: "completed", receivedBytes: 10, totalBytes: 10, agentInitiated: false, startedAt: 1 });
    database.saveCredential("default", { id: "login", origin: "https://example.com", username: "person", encryptedPassword: Uint8Array.from([1, 2, 3]) });
    database.saveExtensionInstall("default", {
      id: "gallery-extension", name: "Gallery Extension", version: "1.0.0", enabled: true,
      source: "gallery", manifestJson: "{}",
    });
    database.saveExtensionInstall("default", {
      id: "developer-extension", name: "Private Developer Path", version: "1.0.0", enabled: true,
      source: "developer", installPath: "/private/developer-extension", manifestJson: "{}",
    });

    let counter = 0;
    expect(database.queueSyncSnapshot("default", "device-a", () => `1787408000000-${String(counter++).padStart(6, "0")}-device-a`)).toBeGreaterThan(0);
    const records = database.syncOutbox("default");
    expect(new Set(records.map((record) => record.collection))).toEqual(new Set(["bookmarks", "history", "tab-groups", "remote-tabs", "settings", "extensions"]));
    expect(records.filter((record) => record.collection === "remote-tabs")).toHaveLength(1);
    expect(records.find((record) => record.collection === "settings")?.recordId).toBe("appearance");
    expect(JSON.stringify(records)).not.toContain("secret.pdf");
    expect(JSON.stringify(records)).not.toContain("person");
    expect(JSON.stringify(records)).not.toContain("developer-extension");
    expect(JSON.stringify(records)).not.toContain("/private/developer-extension");
    database.close();

    const reopened = new BrowserDatabase(path);
    expect(reopened.syncOutboxCount("default")).toBe(records.length);
    reopened.close();
  });

  it("applies newer remote records, exposes remote tabs, and rejects stale replays", () => {
    const database = new BrowserDatabase(join(mkdtempSync(join(tmpdir(), "locus-sync-pull-")), "browser.sqlite"));
    const older = "1787408000000-000000-device-a";
    const newer = "1787408000001-000000-device-b";
    expect(database.applyPulledSyncRecord("default", {
      collection: "settings", recordId: "appearance", clock: newer, tombstone: false, value: "dark", deviceId: "device-b",
    })).toBe(true);
    expect(database.setting("default", "appearance")).toBe("dark");
    expect(database.applyPulledSyncRecord("default", {
      collection: "settings", recordId: "appearance", clock: older, tombstone: false, value: "light", deviceId: "device-a",
    })).toBe(false);
    expect(database.setting("default", "appearance")).toBe("dark");

    database.applyPulledSyncRecord("default", {
      collection: "remote-tabs", recordId: "device-b:tab-1", clock: newer, tombstone: false,
      value: { title: "Remote page", url: "https://remote.example", groupId: "research" }, deviceId: "device-b",
    });
    expect(database.listRemoteTabs("default", "device-a")).toMatchObject([{ title: "Remote page", url: "https://remote.example", deviceId: "device-b" }]);
    expect(database.listRemoteTabs("default", "device-b")).toEqual([]);
    database.close();
  });

  it("resets local sync metadata after cloud deletion so unchanged data is uploaded again", () => {
    const database = new BrowserDatabase(join(mkdtempSync(join(tmpdir(), "locus-sync-reset-")), "browser.sqlite"));
    database.addBookmark("default", "Example", "https://example.com");
    let counter = 0;
    const clock = () => `1787408000000-${String(counter++).padStart(6, "0")}-device-a`;
    expect(database.queueSyncSnapshot("default", "device-a", clock)).toBe(1);
    database.clearSyncOutbox("default", database.syncOutbox("default"));
    expect(database.queueSyncSnapshot("default", "device-a", clock)).toBe(0);
    database.setSyncProgress("default", 42, clock());
    database.resetSyncData("default");
    expect(database.syncProgress("default").cursor).toBe(0);
    expect(database.queueSyncSnapshot("default", "device-a", clock)).toBe(1);
    database.close();
  });

  it("persists and atomically advances the OS-encrypted account-key version", () => {
    const database = new BrowserDatabase(join(mkdtempSync(join(tmpdir(), "locus-sync-key-version-")), "browser.sqlite"));
    database.saveSyncAccount({
      profileId: "default",
      serviceUrl: "https://sync.example.com",
      accountId: "account-a",
      deviceId: "device-a",
      devicePublicKey: "public-key",
      encryptedDevicePrivateKey: new Uint8Array([1]),
      encryptedDeviceToken: new Uint8Array([2]),
      encryptedAccountKey: new Uint8Array([3]),
      keyVersion: 1,
      status: "connected",
    });
    expect(database.syncAccount("default")?.keyVersion).toBe(1);
    database.updateSyncAccountKey("default", new Uint8Array([4, 5]), 2);
    expect(database.syncAccount("default")).toMatchObject({ keyVersion: 2, status: "connected", lastError: null });
    expect([...database.syncAccount("default")!.encryptedAccountKey]).toEqual([4, 5]);
    database.close();
  });
});
