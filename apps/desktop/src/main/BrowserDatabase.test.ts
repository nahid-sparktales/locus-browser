import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

    database.recordVisit("tab-1", "https://example.com/docs", "Example Docs");
    expect(database.listHistory()).toMatchObject([
      { title: "Example Docs", url: "https://example.com/docs" },
    ]);

    const bookmarkId = database.addBookmark("Example", "https://example.com");
    expect(database.bookmarkForUrl("https://example.com")?.id).toBe(bookmarkId);
    expect(database.listBookmarks()).toHaveLength(1);
    database.removeBookmark(bookmarkId);
    expect(database.listBookmarks()).toEqual([]);
    expect(database.bookmarkForUrl("https://example.com")).toBeUndefined();

    database.close();
  });

  it("updates download progress without replacing its identity", () => {
    const database = new BrowserDatabase(join(mkdtempSync(join(tmpdir(), "locus-download-")), "browser.sqlite"));
    database.saveDownload({
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
    database.saveDownload({
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

    expect(database.listDownloads()).toMatchObject([{
      id: "download-1",
      filename: "report.pdf",
      state: "completed",
      receivedBytes: 1_024,
      finishedAt: 124,
    }]);
    database.close();
  });
});
