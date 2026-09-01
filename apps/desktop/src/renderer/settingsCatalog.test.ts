import { describe, expect, it } from "vitest";
import { SETTINGS_PAGE_IDS } from "../shared/settings.js";
import { resolveSessionSettingsPage, SETTINGS_GROUPS, SETTINGS_PAGES, SETTINGS_SEARCH_ITEMS, searchSettings } from "./settingsCatalog.js";

describe("settings catalog", () => {
  it("uses unique allowlisted page, item, and anchor identifiers", () => {
    expect(new Set(SETTINGS_PAGES.map((page) => page.id)).size).toBe(SETTINGS_PAGE_IDS.length);
    expect(SETTINGS_PAGES.map((page) => page.id).sort()).toEqual([...SETTINGS_PAGE_IDS].sort());
    expect(new Set(SETTINGS_SEARCH_ITEMS.map((item) => item.id)).size).toBe(SETTINGS_SEARCH_ITEMS.length);
    expect(new Set(SETTINGS_SEARCH_ITEMS.map((item) => item.anchor)).size).toBe(SETTINGS_SEARCH_ITEMS.length);
    expect(SETTINGS_SEARCH_ITEMS.every((item) => SETTINGS_PAGE_IDS.includes(item.page) && /^settings-[a-z0-9-]+$/.test(item.anchor))).toBe(true);
    expect(SETTINGS_GROUPS.every((group) => SETTINGS_PAGES.some((page) => page.group === group.id))).toBe(true);
  });

  it("finds control names and everyday synonyms", () => {
    expect(searchSettings("password manager").map((item) => item.id)).toContain("passwords");
    expect(searchSettings("ollama").map((item) => item.id)).toContain("local-work-models");
    expect(searchSettings("delete cloud").map((item) => item.id)).toContain("sync-danger");
    expect(searchSettings("sui memory").map((item) => item.id)).toContain("walrus-memory");
  });

  it("keeps the session page unless a routed destination overrides it", () => {
    expect(resolveSessionSettingsPage("privacy")).toBe("privacy");
    expect(resolveSessionSettingsPage("privacy", "models")).toBe("models");
  });

  it("represents every retained settings control", () => {
    const represented = new Set(SETTINGS_SEARCH_ITEMS.map((item) => item.id));
    const expected = [
      "search-engine", "sleep-tabs", "downloads", "theme", "accent-colour", "profiles",
      "provider-accounts", "advanced-provider", "local-work-models", "thinking", "tool-activity",
      "transcription", "speech-model", "speech-endpoint", "recall", "recall-exclusions", "passwords",
      "site-permissions", "encrypted-sync", "sync-devices", "sync-recovery", "sync-danger",
      "extension-gallery", "installed-extensions", "extension-developer-mode", "walrus-memory",
      "walrus-mode", "walrus-manual",
    ];
    expect([...represented].sort()).toEqual(expected.sort());
  });
});
