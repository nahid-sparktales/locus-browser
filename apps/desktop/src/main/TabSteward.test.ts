import { describe, expect, it } from "vitest";
import type { BrowserTabState } from "../shared/types.js";
import { buildTabStewardPreview, canonicalBrowserUrl } from "./TabSteward.js";

const tab = (id: string, title: string, url: string, privateTab = false): BrowserTabState => ({
  id, title, url, active: false, loading: false, canGoBack: false, canGoForward: false,
  audible: false, muted: false, private: privateTab, crashed: false, sleeping: false,
  mediaPlaying: false, mediaAvailable: false, grants: [],
});

describe("TabSteward", () => {
  it("canonicalizes tracking URLs and finds exact duplicates", () => {
    expect(canonicalBrowserUrl("https://Example.com/docs/?utm_source=x#part")).toBe("https://example.com/docs");
    const preview = buildTabStewardPreview([
      tab("a", "Docs", "https://example.com/docs?utm_source=x"),
      tab("b", "Docs", "https://example.com/docs#intro"),
    ]);
    expect(preview.suggestions[0]).toMatchObject({ type: "duplicate", tabIds: ["a", "b"] });
  });

  it("suggests only high-confidence groups of at least three and excludes private tabs", () => {
    const preview = buildTabStewardPreview([
      tab("a", "Electron security guide", "https://electronjs.org/docs/security"),
      tab("b", "Electron process model", "https://electronjs.org/docs/process-model"),
      tab("c", "Electron WebContentsView", "https://electronjs.org/docs/web-contents-view"),
      tab("private", "Electron private", "https://electronjs.org/docs/private", true),
    ]);
    expect(preview.suggestions).toHaveLength(1);
    expect(preview.suggestions[0]).toMatchObject({ type: "group", tabIds: ["a", "b", "c"] });
  });
});
