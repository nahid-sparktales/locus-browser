import type { TabAccessGrant } from "@locus/protocol";

export type WorkMode = "ask" | "work" | "plan" | "build";
export type SidebarSection = "tabs" | "bookmarks" | "history" | "downloads" | "spaces" | "conversations" | "settings";
export type SearchEngine = "duckduckgo" | "brave" | "google" | "bing";
export type Appearance = "system" | "light" | "dark";
export type SitePermissionDecision = "allow" | "deny";
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
  sleeping: boolean;
  mediaPlaying: boolean;
  mediaAvailable: boolean;
  groupId?: string;
  grants: TabAccessGrant[];
}

export interface BrowserProfileState {
  id: string;
  name: string;
  partitionName: string;
  createdAt: number;
}

export interface TabGroupState {
  id: string;
  name: string;
  color: string;
  collapsed: boolean;
  position: number;
}

export interface SitePermissionState {
  origin: string;
  permission: string;
  decision: SitePermissionDecision;
  updatedAt: number;
}

export interface PendingSitePermission {
  requestId: string;
  tabId: string;
  origin: string;
  permission: string;
}

export interface BrowserSettingsState {
  appearance: Appearance;
  searchEngine: SearchEngine;
  sleepAfterMinutes: 0 | 15 | 30 | 60;
  downloadDirectory: string;
  onboardingComplete: boolean;
}

export interface CredentialSuggestionState {
  id: string;
  username: string;
}

export interface SavedCredentialState extends CredentialSuggestionState {
  origin: string;
  updatedAt: number;
}

export interface PendingCredentialPrompt {
  origin: string;
  username: string;
  action: "save" | "update";
}

export interface RemoteTabState {
  id: string;
  deviceId: string;
  title: string;
  url: string;
  groupId?: string;
  updatedAt: number;
}

export interface SyncAccountState {
  status: "disconnected" | "connecting" | "waiting-for-approval" | "connected" | "syncing" | "error";
  serviceUrl?: string;
  accountId?: string;
  deviceId?: string;
  keyVersion?: number;
  lastSyncedAt?: number;
  lastError?: string;
  pendingRecords: number;
  devices: SyncDeviceState[];
  pendingEnrollment?: PendingDeviceEnrollmentState;
}

export interface SyncDeviceState {
  deviceId: string;
  name: string;
  current: boolean;
  keyVersion: number;
  createdAt: number;
  lastSeenAt: number;
}

export interface PendingDeviceEnrollmentState {
  pairingCode: string;
  expiresAt: number;
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
  groups: TabGroupState[];
  profiles: BrowserProfileState[];
  currentProfile: BrowserProfileState;
  activeTabId?: string;
  sidebarOpen: boolean;
  sidebarSection: SidebarSection;
  bookmarks: BookmarkState[];
  history: HistoryEntryState[];
  downloads: DownloadState[];
  sitePermissions: SitePermissionState[];
  pendingSitePermission?: PendingSitePermission;
  pendingCredential?: PendingCredentialPrompt;
  credentialSuggestions: CredentialSuggestionState[];
  savedCredentials: SavedCredentialState[];
  passwordManagerAvailable: boolean;
  sync: SyncAccountState;
  remoteTabs: RemoteTabState[];
  onboardingRequired: boolean;
  settings: BrowserSettingsState;
  activePageBookmarked: boolean;
  find: FindState;
  zoomFactor: number;
  workOpen: boolean;
  workWidth: number;
  workOverlay: boolean;
  searchEngine: SearchEngine;
  work: WorkState;
}
