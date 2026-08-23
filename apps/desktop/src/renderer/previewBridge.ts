import type { LocusBrowserAPI } from "../preload/index.js";
import type { BrowserCommand } from "../shared/ipc.js";
import type { BrowserAppState } from "../shared/types.js";

const previewParams = new URLSearchParams(window.location.search);
const previewOnboarding = previewParams.has("onboarding");
const previewCredential = previewParams.has("credential");
const previewSync = previewParams.has("sync");
const previewPairing = previewParams.has("pairing");

const previewState: BrowserAppState = {
  windowId: "preview",
  profileId: "default",
  privateWindow: false,
  tabs: [
    {
      id: "welcome",
      title: "Locus Browser",
      url: "https://github.com/nahid-sparktales/locus-browser",
      active: true,
      loading: false,
      canGoBack: false,
      canGoForward: false,
      audible: false,
      muted: false,
      private: false,
      crashed: false,
      sleeping: false,
      mediaPlaying: false,
      mediaAvailable: false,
      groupId: "locus-projects",
      grants: [],
    },
    {
      id: "platform",
      title: "Locus Platform",
      url: "https://github.com/nahid-sparktales/locus-platform",
      active: false,
      loading: false,
      canGoBack: true,
      canGoForward: false,
      audible: false,
      muted: false,
      private: false,
      crashed: false,
      sleeping: false,
      mediaPlaying: false,
      mediaAvailable: false,
      groupId: "locus-projects",
      grants: [],
    },
  ],
  groups: [{ id: "locus-projects", name: "Locus projects", color: "lime", collapsed: false, position: 0 }],
  profiles: [{ id: "default", name: "Personal", partitionName: "persist:locus-profile-default", createdAt: 1_787_408_000 }],
  currentProfile: { id: "default", name: "Personal", partitionName: "persist:locus-profile-default", createdAt: 1_787_408_000 },
  activeTabId: "welcome",
  sidebarOpen: true,
  sidebarSection: "tabs",
  bookmarks: [
    { id: "locus", title: "Locus Browser", url: "https://github.com/nahid-sparktales/locus-browser", createdAt: 1_787_408_000, updatedAt: 1_787_408_000 },
  ],
  history: [
    { id: "history-1", title: "Locus Platform", url: "https://github.com/nahid-sparktales/locus-platform", visitedAt: 1_787_408_000 },
  ],
  downloads: [],
  sitePermissions: [],
  ...(previewCredential ? { pendingCredential: { origin: "https://github.com", username: "nahid@example.com", action: "save" as const } } : {}),
  credentialSuggestions: [{ id: "demo-login", username: "nahid@example.com" }],
  savedCredentials: [{ id: "demo-login", origin: "https://github.com", username: "nahid@example.com", updatedAt: 1_787_408_000 }],
  passwordManagerAvailable: true,
  sync: previewSync
    ? {
        status: "connected", serviceUrl: "https://sync.locusbrowser.test", accountId: "account-preview", deviceId: "macbook-local",
        keyVersion: 2, lastSyncedAt: 1_787_408_000, pendingRecords: 0,
        devices: [
          { deviceId: "macbook-local", name: "Nahid’s MacBook · Personal", current: true, keyVersion: 2, createdAt: 1_786_716_000, lastSeenAt: 1_787_408_000 },
          { deviceId: "ipad-7d3e2a", name: "iPad Pro", current: false, keyVersion: 2, createdAt: 1_786_802_400, lastSeenAt: 1_787_404_400 },
          { deviceId: "studio-19a6", name: "Studio Mac · Work", current: false, keyVersion: 2, createdAt: 1_786_975_200, lastSeenAt: 1_787_322_000 },
        ],
      }
    : previewPairing
      ? {
          status: "waiting-for-approval", serviceUrl: "https://sync.locusbrowser.test", pendingRecords: 0, devices: [],
          pendingEnrollment: {
            pairingCode: "LOCUS-DEVICE:8c44d3a0-68ab-4df7-8a6a-874099243345:Xz7x1Sf-P8gF3dWm2Jk5cQ0n",
            expiresAt: 1_787_408_600,
          },
        }
      : { status: "disconnected", pendingRecords: 0, devices: [] },
  remoteTabs: previewSync ? [{ id: "ipad:tab-1", deviceId: "ipad-7d3e2a", title: "Locus protocol notes", url: "https://example.com/protocol", updatedAt: 1_787_408_000 }] : [],
  onboardingRequired: previewOnboarding,
  settings: { appearance: "system", searchEngine: "duckduckgo", sleepAfterMinutes: 30, downloadDirectory: "/Users/nahid/Downloads", onboardingComplete: !previewOnboarding },
  activePageBookmarked: true,
  find: { open: false, query: "", matches: 0, activeMatchOrdinal: 0 },
  zoomFactor: 1,
  workOpen: false,
  workWidth: 420,
  workOverlay: false,
  searchEngine: "duckduckgo",
  work: {
    sessionId: "preview-session",
    mode: "work",
    panel: "chat",
    runtime: "online",
    runtimeMessage: "Local agent is ready",
    busy: false,
    messages: [{
      id: "welcome-message",
      role: "assistant",
      text: "Work Mode is ready. Share this tab when you want Locus to read or interact with it.",
    }],
  },
};

export function installPreviewBridge(): void {
  if (typeof window.locusBrowser !== "undefined") return;
  const listeners = new Set<(state: BrowserAppState) => void>();
  const focusListeners = new Set<() => void>();
  const publish = () => {
    for (const listener of listeners) listener(structuredClone(previewState));
  };
  const api: LocusBrowserAPI = {
    getState: async () => structuredClone(previewState),
    command: async (value) => {
      applyPreviewCommand(value);
      publish();
      return structuredClone(previewState);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onFocusAddress: (listener) => {
      focusListeners.add(listener);
      return () => focusListeners.delete(listener);
    },
  };
  window.locusBrowser = api;
}

function applyPreviewCommand(command: BrowserCommand): void {
  switch (command.type) {
    case "toggle-sidebar":
      previewState.sidebarOpen = !previewState.sidebarOpen;
      break;
    case "set-sidebar-section":
      previewState.sidebarOpen = true;
      previewState.sidebarSection = command.section;
      break;
    case "toggle-work":
      previewState.workOpen = !previewState.workOpen;
      break;
    case "toggle-bookmark":
      previewState.activePageBookmarked = !previewState.activePageBookmarked;
      previewState.bookmarks = previewState.activePageBookmarked ? [{
        id: "locus",
        title: "Locus Browser",
        url: "https://github.com/nahid-sparktales/locus-browser",
        createdAt: 1_787_408_000,
        updatedAt: 1_787_408_000,
      }] : [];
      break;
    case "toggle-find":
      previewState.find.open = !previewState.find.open;
      break;
    case "find-in-page":
      previewState.find = { open: true, query: command.query, matches: command.query ? 3 : 0, activeMatchOrdinal: command.query ? 1 : 0 };
      break;
    case "close-find":
      previewState.find = { open: false, query: "", matches: 0, activeMatchOrdinal: 0 };
      break;
    case "zoom-in":
      previewState.zoomFactor = Math.min(previewState.zoomFactor + 0.1, 2);
      break;
    case "zoom-out":
      previewState.zoomFactor = Math.max(previewState.zoomFactor - 0.1, 0.5);
      break;
    case "zoom-reset":
      previewState.zoomFactor = 1;
      break;
    case "select-tab":
      previewState.activeTabId = command.tabId;
      previewState.tabs = previewState.tabs.map((tab) => ({ ...tab, active: tab.id === command.tabId }));
      break;
    case "new-private-window":
      previewState.privateWindow = true;
      previewState.workOpen = false;
      previewState.history = [];
      previewState.tabs = previewState.tabs.map((tab) => ({ ...tab, private: true, grants: [] }));
      break;
    case "create-tab-group": {
      const id = `group-${previewState.groups.length + 1}`;
      previewState.groups.push({ id, name: `Group ${previewState.groups.length + 1}`, color: "blue", collapsed: false, position: previewState.groups.length });
      previewState.tabs = previewState.tabs.map((tab) => tab.id === command.tabId ? { ...tab, groupId: id } : tab);
      break;
    }
    case "toggle-tab-group":
      previewState.groups = previewState.groups.map((group) => group.id === command.groupId ? { ...group, collapsed: !group.collapsed } : group);
      break;
    case "rename-tab-group":
      previewState.groups = previewState.groups.map((group) => group.id === command.groupId ? { ...group, name: command.name } : group);
      break;
    case "set-tab-group":
      previewState.tabs = previewState.tabs.map((tab) => {
        if (tab.id !== command.tabId) return tab;
        const { groupId: _groupId, ...withoutGroup } = tab;
        return command.groupId ? { ...withoutGroup, groupId: command.groupId } : withoutGroup;
      });
      break;
    case "sleep-tab":
      previewState.tabs = previewState.tabs.map((tab) => tab.id === command.tabId ? { ...tab, sleeping: true } : tab);
      break;
    case "set-appearance":
      previewState.settings.appearance = command.appearance;
      break;
    case "set-search-engine":
      previewState.settings.searchEngine = command.searchEngine;
      previewState.searchEngine = command.searchEngine;
      break;
    case "set-sleep-after":
      previewState.settings.sleepAfterMinutes = command.minutes;
      break;
    case "delete-profile":
      previewState.profiles = previewState.profiles.filter((profile) => profile.id !== command.profileId);
      break;
    case "complete-onboarding":
      previewState.settings = {
        ...previewState.settings,
        searchEngine: command.searchEngine,
        appearance: command.appearance,
        sleepAfterMinutes: command.sleepAfterMinutes,
        onboardingComplete: true,
      };
      previewState.searchEngine = command.searchEngine;
      previewState.onboardingRequired = false;
      break;
    case "dismiss-pending-credential":
    case "save-pending-credential":
      delete previewState.pendingCredential;
      break;
    case "delete-credential":
      previewState.savedCredentials = previewState.savedCredentials.filter((credential) => credential.id !== command.credentialId);
      previewState.credentialSuggestions = previewState.credentialSuggestions.filter((credential) => credential.id !== command.credentialId);
      break;
    case "begin-sync-registration":
    case "begin-sync-sign-in":
      previewState.sync = { status: "connecting", serviceUrl: command.serviceUrl, pendingRecords: 0, devices: [] };
      break;
    case "begin-sync-device-enrollment":
      previewState.sync = {
        status: "waiting-for-approval", serviceUrl: command.serviceUrl, pendingRecords: 0, devices: [],
        pendingEnrollment: {
          pairingCode: "LOCUS-DEVICE:8c44d3a0-68ab-4df7-8a6a-874099243345:Xz7x1Sf-P8gF3dWm2Jk5cQ0n",
          expiresAt: Math.floor(Date.now() / 1_000) + 600,
        },
      };
      break;
    case "cancel-sync-device-enrollment":
      previewState.sync = { status: "disconnected", pendingRecords: 0, devices: [] };
      break;
    case "revoke-sync-device":
      previewState.sync.devices = previewState.sync.devices.filter((device) => device.deviceId !== command.deviceId);
      break;
    case "approve-sync-device":
      previewState.sync.devices = [...previewState.sync.devices, {
        deviceId: "new-device-preview",
        name: "New Mac · Personal",
        current: false,
        keyVersion: previewState.sync.keyVersion ?? 1,
        createdAt: Math.floor(Date.now() / 1_000),
        lastSeenAt: Math.floor(Date.now() / 1_000),
      }];
      break;
    case "rotate-sync-recovery-key": {
      const keyVersion = (previewState.sync.keyVersion ?? 1) + 1;
      previewState.sync = {
        ...previewState.sync,
        keyVersion,
        devices: previewState.sync.devices.map((device) => ({ ...device, keyVersion })),
      };
      break;
    }
    case "sync-now":
      if (previewState.sync.accountId) previewState.sync = { ...previewState.sync, status: "syncing" };
      break;
    case "disconnect-sync":
    case "delete-sync-account":
      previewState.sync = { status: "disconnected", pendingRecords: 0, devices: [] };
      previewState.remoteTabs = [];
      break;
    default:
      break;
  }
}
