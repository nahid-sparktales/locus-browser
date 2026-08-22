import type { TabAccessGrant } from "@locus/protocol";

export type WorkMode = "ask" | "work" | "plan" | "build";
export type SidebarSection = "tabs" | "bookmarks" | "history" | "downloads" | "spaces" | "conversations";
export type WorkPanel =
  | "chat"
  | "overview"
  | "plan"
  | "changes"
  | "files"
  | "terminal"
  | "checkpoints"
  | "runs"
  | "notes"
  | "agents";

export interface BrowserTabState {
  id: string;
  title: string;
  url: string;
  faviconUrl?: string;
  active: boolean;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  audible: boolean;
  muted: boolean;
  private: boolean;
  crashed: boolean;
  grants: TabAccessGrant[];
}

export interface BookmarkState {
  id: string;
  title: string;
  url: string;
  createdAt: number;
  updatedAt: number;
}

export interface HistoryEntryState {
  id: string;
  title: string;
  url: string;
  visitedAt: number;
}

export interface DownloadState {
  id: string;
  tabId?: string;
  filename: string;
  url: string;
  path: string;
  state: "progressing" | "completed" | "cancelled" | "interrupted";
  receivedBytes: number;
  totalBytes: number;
  agentInitiated: boolean;
  startedAt: number;
  finishedAt?: number;
}

export interface FindState {
  open: boolean;
  query: string;
  matches: number;
  activeMatchOrdinal: number;
}

export interface WorkMessage {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  streaming?: boolean;
}

export interface PendingPermission {
  requestId: string;
  tool: string;
  summary: string;
}

export interface WorkState {
  sessionId: string;
  mode: WorkMode;
  panel: WorkPanel;
  runtime: "starting" | "online" | "offline";
  runtimeMessage: string;
  busy: boolean;
  messages: WorkMessage[];
  pendingPermission?: PendingPermission;
}

export interface BrowserAppState {
  windowId: string;
  profileId: string;
  privateWindow: boolean;
  tabs: BrowserTabState[];
  activeTabId?: string;
  sidebarOpen: boolean;
  sidebarSection: SidebarSection;
  bookmarks: BookmarkState[];
  history: HistoryEntryState[];
  downloads: DownloadState[];
  activePageBookmarked: boolean;
  find: FindState;
  zoomFactor: number;
  workOpen: boolean;
  workWidth: number;
  workOverlay: boolean;
  searchEngine: "duckduckgo";
  work: WorkState;
}
