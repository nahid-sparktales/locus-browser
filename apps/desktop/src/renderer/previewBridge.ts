import type { LocusBrowserAPI } from "../preload/index.js";
import type { BrowserCommand } from "../shared/ipc.js";
import type { BrowserAppState } from "../shared/types.js";

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
  settings: { appearance: "system", searchEngine: "duckduckgo", sleepAfterMinutes: 30, downloadDirectory: "/Users/nahid/Downloads" },
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
    default:
      break;
  }
}
