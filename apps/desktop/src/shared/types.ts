import type { TabAccessGrant } from "@locus/protocol";

export type WorkMode = "ask" | "work" | "plan" | "build";
export type WorkModelProviderId = "chatgpt-plan" | "openai-api" | "kimi" | "claude-api" | "vllm" | "local";
export type SidebarSection = "tabs" | "bookmarks" | "history" | "downloads" | "spaces" | "conversations" | "settings";
export type SearchEngine = "duckduckgo" | "brave" | "google" | "bing";
export type Appearance = "system" | "light" | "dark";
export type SitePermissionDecision = "allow" | "deny";
export type WorkPanel =
  | "chat"
  | "plan"
  | "changes"
  | "files"
  | "terminal";

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

export interface ExtensionInstallState {
  id: string;
  name: string;
  version: string;
  description?: string;
  enabled: boolean;
  loaded: boolean;
  source: "gallery" | "developer";
  installPath?: string;
  permissions: string[];
  hostPermissions: string[];
  verifiedPublisher?: string;
  galleryKeyName?: string;
  rollbackVersion?: string;
  error?: string;
  updatedAt: number;
}

export interface ExtensionManagerState {
  developerMode: boolean;
  loading: boolean;
  installs: ExtensionInstallState[];
  supportedApiCount: number;
  trustedGalleryKeyCount: number;
  message: string;
  gallery?: ExtensionGalleryState;
}

export interface ExtensionGalleryEntryState {
  id: string;
  name: string;
  version: string;
  description?: string;
  permissions: string[];
  hostPermissions: string[];
  verifiedPublisher: string;
  packageSize: number;
  action: "install" | "update" | "installed";
  installedVersion?: string;
}

export interface ExtensionGalleryState {
  status: "disabled" | "loading" | "ready" | "error";
  message: string;
  serviceUrl?: string;
  refreshedAt?: number;
  entries: ExtensionGalleryEntryState[];
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

export interface WorkConversationState {
  id: string;
  title: string;
  preview: string;
  updatedAt: number;
  current: boolean;
  cwd?: string;
}

export interface WorkWorkspaceState {
  name: string;
  path: string;
}

export interface WorkAttachmentState {
  id: string;
  name: string;
  mimeType: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
  size: number;
}

export interface WorkModelOptionState {
  id: string;
  name: string;
  detail?: string;
  vision?: boolean;
}

export interface WorkModelProviderState {
  id: WorkModelProviderId;
  name: string;
  detail: string;
  mark: string;
  configured: boolean;
  status: "ready" | "needs-key" | "needs-setup" | "needs-sign-in" | "signing-in" | "unavailable";
  statusMessage: string;
  models: WorkModelOptionState[];
  baseUrl?: string;
}

export interface WorkModelState {
  activeProvider: WorkModelProviderId;
  activeModel: string;
  label: string;
  switching: boolean;
  providers: WorkModelProviderState[];
  message?: string;
}

export interface PendingPermission {
  requestId: string;
  tool: string;
  summary: string;
}

export interface WorkTodoState {
  content: string;
  status: "pending" | "in_progress" | "completed";
}

export interface WorkPlanState {
  id: string;
  title: string;
  summary: string;
  steps: WorkTodoState[];
  tests: string[];
  pendingApproval: boolean;
}

export interface WorkChangeFileState {
  path: string;
  originalPath?: string;
  status: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
  binary: boolean;
  additions?: number;
  deletions?: number;
}

export interface WorkChangesState {
  loading: boolean;
  isRepository: boolean;
  branch?: string;
  detached: boolean;
  ahead: number;
  behind: number;
  files: WorkChangeFileState[];
  selectedPath?: string;
  selectedStaged?: boolean;
  diff?: string;
  diffBinary?: boolean;
  diffTruncated?: boolean;
  error?: string | undefined;
}

export interface WorkFileEntryState {
  path: string;
  name: string;
  size: number;
  modifiedAt: number;
}

export interface WorkFilesState {
  loading: boolean;
  entries: WorkFileEntryState[];
  truncated: boolean;
  selectedPath?: string;
  content?: string | undefined;
  contentTruncated?: boolean;
  error?: string | undefined;
}

export interface WorkTerminalEntryState {
  id: string;
  tool: string;
  summary: string;
  detail: string;
  status: "running" | "waiting" | "done" | "error" | "denied" | "interrupted";
  result?: string;
  startedAt: number;
  finishedAt?: number;
}

export interface WorkRuntimeRecoveryState {
  attempt: number;
  retrying: boolean;
  canRetry: boolean;
}

export interface WorkState {
  sessionId: string;
  mode: WorkMode;
  panel: WorkPanel;
  runtime: "starting" | "online" | "offline";
  runtimeMessage: string;
  busy: boolean;
  messages: WorkMessage[];
  conversations: WorkConversationState[];
  attachments: WorkAttachmentState[];
  model: WorkModelState;
  plan?: WorkPlanState;
  changes: WorkChangesState;
  files: WorkFilesState;
  terminal: WorkTerminalEntryState[];
  recovery: WorkRuntimeRecoveryState;
  workspace?: WorkWorkspaceState;
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
  extensions: ExtensionManagerState;
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
