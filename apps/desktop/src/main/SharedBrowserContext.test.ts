import { describe, expect, it } from "vitest";
import { referencesCurrentPage, sharedBrowserContext } from "./SharedBrowserContext.js";

describe("sharedBrowserContext", () => {
  it("builds bounded read-only page context without requiring a recording", () => {
    const context = sharedBrowserContext({
      id: "tab-1",
      title: "Example",
      url: "https://example.com/article",
      accessLevel: "read",
    }, "x".repeat(13_000), new Date("2026-08-24T12:00:00.000Z"));

    expect(context.recording_id).toBe("shared-tab-tab-1");
    expect(context.active_tab?.access_level).toBe("read");
    expect(context.page_text).toHaveLength(12_000);
    expect(context.transcript).toEqual([]);
    expect(context.frames).toEqual([]);
  });

  it("recognizes current-page requests without mistaking explicit URLs", () => {
    expect(referencesCurrentPage("summarize the page for me")).toBe(true);
    expect(referencesCurrentPage("what does this article claim?")).toBe(true);
    expect(referencesCurrentPage("summarize https://example.com/article")).toBe(false);
    expect(referencesCurrentPage("what are the current site permissions?")).toBe(false);
  });
});
