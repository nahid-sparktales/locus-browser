import { resolveAccentSelection } from "../shared/accent.js";
import type { Appearance, BrowserSettingsState, SearchEngine, SpeechSettings } from "../shared/types.js";
import type { BrowserDatabase } from "./BrowserDatabase.js";

export function loadBrowserSettings(
  database: BrowserDatabase,
  profileId: string,
  defaultDownloadDirectory: string,
  speech: SpeechSettings,
): BrowserSettingsState {
  const setting = (key: string) => database.setting(profileId, key);
  const appearance = setting("appearance");
  const searchEngine = setting("searchEngine");
  const sleepAfterMinutes = setting("sleepAfterMinutes");
  const downloadDirectory = setting("downloadDirectory");
  const thinkingVisibility = setting("thinkingVisibility");
  const toolActivityVisibility = setting("toolActivityVisibility");

  return {
    appearance: isAppearance(appearance) ? appearance : "system",
    accent: resolveAccentSelection(setting("accentPreset"), setting("customAccentHex")),
    searchEngine: isSearchEngine(searchEngine) ? searchEngine : "duckduckgo",
    sleepAfterMinutes: isSleepInterval(sleepAfterMinutes) ? sleepAfterMinutes : 30,
    downloadDirectory: typeof downloadDirectory === "string" && downloadDirectory ? downloadDirectory : defaultDownloadDirectory,
    onboardingComplete: setting("onboardingComplete") === true,
    localModelsEnabled: setting("localModelsEnabled") === true,
    semanticRecallEnabled: setting("semanticRecallEnabled") === true,
    thinkingVisibility: isThinkingVisibility(thinkingVisibility) ? thinkingVisibility : "collapsed",
    toolActivityVisibility: isToolActivityVisibility(toolActivityVisibility) ? toolActivityVisibility : "collapsed",
    speech,
  };
}

function isAppearance(value: unknown): value is Appearance {
  return value === "system" || value === "light" || value === "dark";
}

function isSearchEngine(value: unknown): value is SearchEngine {
  return value === "duckduckgo" || value === "brave" || value === "google" || value === "bing";
}

function isSleepInterval(value: unknown): value is BrowserSettingsState["sleepAfterMinutes"] {
  return value === 0 || value === 15 || value === 30 || value === 60;
}

function isThinkingVisibility(value: unknown): value is BrowserSettingsState["thinkingVisibility"] {
  return value === "hidden" || value === "collapsed" || value === "expanded";
}

function isToolActivityVisibility(value: unknown): value is BrowserSettingsState["toolActivityVisibility"] {
  return value === "verbose" || value === "collapsed" || value === "hidden";
}
