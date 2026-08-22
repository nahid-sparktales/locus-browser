import type { TabAccessGrant } from "@locus/protocol";

export type WorkMode = "ask" | "work" | "plan" | "build";
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
  tabs: BrowserTabState[];
  activeTabId?: string;
  sidebarOpen: boolean;
  workOpen: boolean;
  workWidth: number;
  workOverlay: boolean;
  searchEngine: "duckduckgo";
  work: WorkState;
}
