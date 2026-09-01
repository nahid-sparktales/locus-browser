import type { SettingsPageId } from "../shared/settings.js";

export type SettingsGroupId = "browser" | "work" | "privacy-data" | "tools";

export interface SettingsPageDescriptor {
  id: SettingsPageId;
  group: SettingsGroupId;
  title: string;
  description: string;
}

export interface SettingsSearchItem {
  id: string;
  page: SettingsPageId;
  title: string;
  description: string;
  anchor: string;
  synonyms: readonly string[];
}

export const SETTINGS_GROUPS: ReadonlyArray<{ id: SettingsGroupId; title: string }> = [
  { id: "browser", title: "Browser" },
  { id: "work", title: "Work" },
  { id: "privacy-data", title: "Privacy & data" },
  { id: "tools", title: "Tools" },
];

export const SETTINGS_PAGES: readonly SettingsPageDescriptor[] = [
  { id: "general", group: "browser", title: "General", description: "Search, downloads, and background tabs." },
  { id: "appearance", group: "browser", title: "Appearance", description: "Theme, accent colour, Locus marks, and interface highlights." },
  { id: "profiles", group: "browser", title: "Profiles", description: "Keep cookies, browsing data, and extensions separate." },
  { id: "models", group: "work", title: "AI models & accounts", description: "Connect accounts and choose how Work responds." },
  { id: "speech", group: "work", title: "Speech", description: "Choose how live browser audio is transcribed." },
  { id: "privacy", group: "privacy-data", title: "Privacy & security", description: "Control Recall, saved logins, and site access." },
  { id: "sync", group: "privacy-data", title: "Sync", description: "Optionally sync browser data with end-to-end encryption." },
  { id: "extensions", group: "tools", title: "Extensions", description: "Manage verified extensions and developer tools." },
  { id: "integrations", group: "tools", title: "Integrations", description: "Connect optional services with explicit data boundaries." },
];

export const SETTINGS_SEARCH_ITEMS: readonly SettingsSearchItem[] = [
  { id: "search-engine", page: "general", title: "Search engine", description: "Choose the search used by the address bar.", anchor: "settings-search-engine", synonyms: ["omnibox", "duckduckgo", "brave", "google", "bing"] },
  { id: "sleep-tabs", page: "general", title: "Sleep background tabs", description: "Save memory by pausing inactive tabs.", anchor: "settings-sleep-tabs", synonyms: ["inactive", "memory", "performance", "background"] },
  { id: "downloads", page: "general", title: "Downloads folder", description: "Choose where downloaded files are saved.", anchor: "settings-downloads", synonyms: ["directory", "folder", "save"] },
  { id: "theme", page: "appearance", title: "Appearance", description: "Follow the system or use light or dark mode.", anchor: "settings-theme", synonyms: ["theme", "dark", "light", "system"] },
  { id: "accent-colour", page: "appearance", title: "Accent colour", description: "Change highlights, icons, and Locus marks together.", anchor: "settings-accent", synonyms: ["color", "colour", "logo", "icons", "brand"] },
  { id: "profiles", page: "profiles", title: "Browser profiles", description: "Manage separate browsing identities.", anchor: "settings-profile-list", synonyms: ["cookies", "identity", "delete profile"] },
  { id: "provider-accounts", page: "models", title: "AI provider accounts", description: "Connect ChatGPT Plan, Kimi, OpenAI, or Claude.", anchor: "settings-provider-accounts", synonyms: ["api key", "account", "chatgpt", "kimi", "openai", "claude", "model"] },
  { id: "advanced-provider", page: "models", title: "Advanced providers", description: "Configure a local or remote vLLM endpoint.", anchor: "settings-advanced-providers", synonyms: ["vllm", "endpoint", "local model"] },
  { id: "local-work-models", page: "models", title: "Local Work models", description: "Show Ollama models in Work.", anchor: "settings-local-models", synonyms: ["ollama", "on device", "local"] },
  { id: "thinking", page: "models", title: "Thinking visibility", description: "Choose how model reasoning appears in Chat.", anchor: "settings-thinking", synonyms: ["reasoning", "collapsed", "expanded"] },
  { id: "tool-activity", page: "models", title: "Tool activity", description: "Choose how agent tool runs appear in Chat.", anchor: "settings-tool-activity", synonyms: ["agent", "tools", "verbose"] },
  { id: "transcription", page: "speech", title: "Transcription", description: "Choose on-device, OpenAI, or custom speech.", anchor: "settings-transcription", synonyms: ["speech", "recording", "whisper", "audio"] },
  { id: "speech-model", page: "speech", title: "Local speech model", description: "Download the on-device transcription model.", anchor: "settings-speech-model", synonyms: ["download", "whisper", "offline"] },
  { id: "speech-endpoint", page: "speech", title: "Custom speech endpoint", description: "Set an OpenAI-compatible transcription endpoint.", anchor: "settings-speech-endpoint", synonyms: ["url", "api", "custom"] },
  { id: "recall", page: "privacy", title: "Private Semantic Recall", description: "Index eligible pages locally and privately.", anchor: "settings-recall", synonyms: ["semantic", "history", "memory", "indexed pages"] },
  { id: "recall-exclusions", page: "privacy", title: "Recall exclusions", description: "Keep selected websites out of Recall.", anchor: "settings-recall-exclusions", synonyms: ["exclude site", "block", "origin"] },
  { id: "passwords", page: "privacy", title: "Saved logins", description: "Manage OS-encrypted usernames and passwords.", anchor: "settings-passwords", synonyms: ["credentials", "password manager", "autofill"] },
  { id: "site-permissions", page: "privacy", title: "Site permissions", description: "Review decisions for camera, microphone, and more.", anchor: "settings-site-permissions", synonyms: ["allow", "block", "camera", "microphone"] },
  { id: "encrypted-sync", page: "sync", title: "Locus encrypted sync", description: "Connect, recover, or disconnect sync.", anchor: "settings-encrypted-sync", synonyms: ["account", "cloud", "end to end", "e2ee"] },
  { id: "sync-devices", page: "sync", title: "Sync devices", description: "Approve or revoke connected devices.", anchor: "settings-sync-devices", synonyms: ["pairing", "revoke", "mac"] },
  { id: "sync-recovery", page: "sync", title: "Sync recovery key", description: "Rotate the recovery key for active devices.", anchor: "settings-sync-recovery", synonyms: ["rotate", "passkey", "recover"] },
  { id: "sync-danger", page: "sync", title: "Sync cloud data controls", description: "Delete cloud data or the sync account.", anchor: "settings-sync-danger", synonyms: ["delete account", "delete cloud", "danger"] },
  { id: "extension-gallery", page: "extensions", title: "Extension gallery", description: "Install independently verified extensions.", anchor: "settings-extension-gallery", synonyms: ["install", "signed package", "locusx"] },
  { id: "installed-extensions", page: "extensions", title: "Installed extensions", description: "Enable, disable, roll back, or remove extensions.", anchor: "settings-installed-extensions", synonyms: ["remove", "disable", "rollback"] },
  { id: "extension-developer-mode", page: "extensions", title: "Extension Developer Mode", description: "Load reviewed, unpacked MV3 extensions.", anchor: "settings-extension-developer", synonyms: ["unpacked", "mv3", "load extension", "advanced"] },
  { id: "walrus-memory", page: "integrations", title: "Walrus Memory", description: "Connect portable memory for selected content.", anchor: "settings-walrus", synonyms: ["sui", "memory", "relayer", "delegate"] },
  { id: "walrus-mode", page: "integrations", title: "Walrus encryption mode", description: "Choose client-encrypted or hosted mode.", anchor: "settings-walrus-mode", synonyms: ["hosted", "client encrypted", "trust"] },
  { id: "walrus-manual", page: "integrations", title: "Manual Walrus configuration", description: "Configure network, package, registry, and embeddings.", anchor: "settings-walrus-manual", synonyms: ["package id", "registry", "embedding", "advanced"] },
];

export function getSettingsPage(id: SettingsPageId): SettingsPageDescriptor {
  return SETTINGS_PAGES.find((page) => page.id === id) ?? SETTINGS_PAGES[0]!;
}

export function searchSettings(query: string): SettingsSearchItem[] {
  const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  return SETTINGS_SEARCH_ITEMS.filter((item) => {
    const haystack = [item.title, item.description, ...item.synonyms].join(" ").toLocaleLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

export function resolveSessionSettingsPage(current: SettingsPageId, requested?: SettingsPageId): SettingsPageId {
  return requested ?? current;
}
