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
});
