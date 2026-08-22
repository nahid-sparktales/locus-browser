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
      grants: [],
    },
  ],
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
    default:
      break;
  }
}
