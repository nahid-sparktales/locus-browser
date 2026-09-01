import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SpeechSettings } from "../shared/types.js";
import { BrowserDatabase } from "./BrowserDatabase.js";
import { loadBrowserSettings } from "./BrowserSettingsPersistence.js";

const speech: SpeechSettings = {
  engine: "local",
  language: "auto",
  localModelStatus: "missing",
};

describe("loadBrowserSettings", () => {
  const databases: BrowserDatabase[] = [];
  afterEach(() => databases.splice(0).forEach((database) => database.close()));

  it("uses safe defaults including the native Locus Lime accent", () => {
    const database = new BrowserDatabase(join(mkdtempSync(join(tmpdir(), "locus-settings-")), "browser.sqlite"));
    databases.push(database);

    expect(loadBrowserSettings(database, "default", "/Downloads", speech)).toMatchObject({
      appearance: "system",
      accent: { preset: "lime", customHex: "4A90FF" },
      searchEngine: "duckduckgo",
      sleepAfterMinutes: 30,
      downloadDirectory: "/Downloads",
      speech,
    });
  });

  it("normalizes persisted settings and rejects malformed accent data", () => {
    const database = new BrowserDatabase(join(mkdtempSync(join(tmpdir(), "locus-settings-")), "browser.sqlite"));
    databases.push(database);
    database.setSetting("default", "appearance", "dark");
    database.setSetting("default", "accentPreset", "purple");
    database.setSetting("default", "customAccentHex", "not-a-colour");
    database.setSetting("default", "searchEngine", "brave");

    expect(loadBrowserSettings(database, "default", "/Downloads", speech)).toMatchObject({
      appearance: "dark",
      accent: { preset: "purple", customHex: "4A90FF" },
      searchEngine: "brave",
    });
  });
});
