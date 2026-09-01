export const SETTINGS_PAGE_IDS = [
  "general",
  "appearance",
  "profiles",
  "models",
  "speech",
  "privacy",
  "sync",
  "extensions",
  "integrations",
] as const;

export type SettingsPageId = (typeof SETTINGS_PAGE_IDS)[number];

export function isSettingsPageId(value: unknown): value is SettingsPageId {
  return typeof value === "string" && SETTINGS_PAGE_IDS.includes(value as SettingsPageId);
}
