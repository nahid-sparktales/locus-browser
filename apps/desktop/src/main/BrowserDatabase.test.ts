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
});
