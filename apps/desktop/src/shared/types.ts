import type { BrowserObservationContext, TabAccessGrant } from "@locus/protocol";
import type { AccentSelectionState } from "./accent.js";
import type { SettingsPageId } from "./settings.js";

export type { AccentPresetId, AccentSelectionId, AccentSelectionState } from "./accent.js";

export type WorkMode = "ask" | "work" | "plan" | "build";
export type WorkModelProviderId = "chatgpt-plan" | "openai-api" | "kimi" | "claude-api" | "vllm" | "local";
export type ThinkingVisibility = "hidden" | "collapsed" | "expanded";
export type ToolActivityVisibility = "verbose" | "collapsed" | "hidden";
export type SidebarSection = "tabs" | "bookmarks" | "history" | "downloads" | "spaces" | "conversations";
export type SearchEngine = "duckduckgo" | "brave" | "google" | "bing";
export type Appearance = "system" | "light" | "dark";
export type BrowserPaneId = "primary" | "secondary";
export type SpeechEngine = "local" | "openai" | "custom";
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
  pane?: BrowserPaneId;
  focused?: boolean;
  grants: TabAccessGrant[];
}

export interface SplitViewState {
  enabled: boolean;
  primaryTabId?: string;
  secondaryTabId?: string;
  focusedPane: BrowserPaneId;
  ratio: number;
}

export interface ReaderPreferencesState {
  theme: "locus" | "paper" | "dark";
  textScale: number;
  columnWidth: "narrow" | "medium" | "wide";
  lineSpacing: number;
  voice?: string;
  rate: number;
}

export interface ReaderState {
  tabId?: string;
  available: boolean;
  active: boolean;
  loading: boolean;
  message?: string;
  preferences: ReaderPreferencesState;
}

export interface ReaderArticleState {
  tabId: string;
  title: string;
  byline?: string;
  url: string;
  lang?: string;
  html: string;
  text: string;
  accent: AccentSelectionState;
  preferences: ReaderPreferencesState;
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
  accent: AccentSelectionState;
  searchEngine: SearchEngine;
  sleepAfterMinutes: 0 | 15 | 30 | 60;
  downloadDirectory: string;
  onboardingComplete: boolean;
  localModelsEnabled: boolean;
  semanticRecallEnabled: boolean;
  thinkingVisibility: ThinkingVisibility;
  toolActivityVisibility: ToolActivityVisibility;
  speech: SpeechSettings;
}

export interface SemanticRecallState {
  enabled: boolean;
  status: "disabled" | "starting" | "ready" | "indexing" | "paused" | "error";
  documentCount: number;
  storageBytes: number;
  capBytes: number;
  excludedOrigins: string[];
  message: string;
}

export interface SemanticRecallResultState {
  id: string;
  title: string;
  url: string;
  visitedAt: number;
  snippet: string;
  score: number;
  source: "open-tab" | "bookmark" | "history";
  openTabId?: string;
}

export interface WalrusMemoryDraftState {
  id: string;
  type: "page" | "research-summary";
  title: string;
  sourceUrl: string;
  capturedAt: string;
  contentSha256: string;
  content: string;
  note: string;
  maxNoteChars: number;
}

export type WalrusMemoryMode = "hosted" | "client-encrypted";

export interface WalrusMemoryState {
  status: "disconnected" | "checking" | "connected" | "saving" | "restoring" | "publishing" | "error";
  usable: boolean;
  message: string;
  mode: WalrusMemoryMode;
  accountId?: string;
  namespace: string;
  relayerUrl: string;
  developmentRelayerAllowed: boolean;
  manualConfigured: boolean;
  network?: "mainnet" | "testnet";
  packageId?: string;
  registryId?: string;
  embeddingApiBase?: string;
  embeddingModel?: string;
  signerAddress?: string;
  connectedAt?: number;
  lastSuccessAt?: number;
  receiptCount: number;
  searchRequestedAt?: number;
  draft?: WalrusMemoryDraftState;
}

export interface WalrusMemoryResultState {
  blobId: string;
  title: string;
  text: string;
  snippet: string;
  relevance: number;
  sourceUrl?: string;
  capturedAt?: string;
  contentSha256?: string;
}

export interface PortableMemoryAttachmentState {
  blobId: string;
  title: string;
  characters: number;
  sourceUrl?: string;
}

export interface ResearchPassageState {
  passageId: string;
  text: string;
}

export interface ResearchSourceState {
  sourceId: string;
  tabId: string;
  title: string;
  url: string;
  capturedAt: string;
  contentHash: string;
  passages: ResearchPassageState[];
}

export interface ResearchCitationState {
  sourceId: string;
  passageId: string;
}

export interface ResearchClaimState {
  text: string;
  citations: ResearchCitationState[];
}

export interface ResearchSectionState {
  heading: string;
  claims: ResearchClaimState[];
}

export interface ResearchBoardState {
  id: string;
  workSessionId: string;
  prompt: string;
  format: "comparison" | "brief" | "evidence";
  title: string;
  summary: string;
  sections: ResearchSectionState[];
  sources: ResearchSourceState[];
  status: "draft" | "generating" | "ready" | "error";
  message?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ResearchBoardSummaryState {
  id: string;
  title: string;
  status: ResearchBoardState["status"];
  sourceCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface ResearchBundleFileState {
  identifier: string;
  mediaType: string;
  bytes: number;
  sha256: string;
}

export interface ResearchBundleDraftState {
  id: string;
  boardId: string;
  title: string;
  visibility: "public" | "seal-encrypted";
  includePassages: boolean;
  network: "mainnet" | "testnet";
  epochs: number;
  files: ResearchBundleFileState[];
  previewMarkdown: string;
  unsignedManifestSha256: string;
  preparedAt: number;
}

export interface ResearchBundleReceiptState {
  id: string;
  boardId: string;
  quiltId: string;
  manifestSha256: string;
  visibility: "public" | "seal-encrypted";
  network: "mainnet" | "testnet";
  epochs: number;
  signerAddress: string;
  files: Array<{ identifier: string; id: string; blobId: string }>;
  createdAt: number;
}

export interface ResearchState {
  boards: ResearchBoardSummaryState[];
  activeBoardId?: string;
  generating: boolean;
  message: string;
  bundleReceipts: ResearchBundleReceiptState[];
  bundleDraft?: ResearchBundleDraftState;
}

export interface TabStewardSuggestionState {
  id: string;
  type: "duplicate" | "group";
  title: string;
  detail: string;
  tabIds: string[];
  groupName?: string;
  confidence: number;
}

export interface TabStewardPreviewState {
  suggestions: TabStewardSuggestionState[];
  generatedAt: number;
}

export interface ResumeBundleState {
  id: string;
  name: string;
  tabCount: number;
  createdAt: number;
}

export interface TabStewardState {
  suggestionCount: number;
  bundleCount: number;
}

export type InternalSurfaceState =
  | { type: "settings"; page?: SettingsPageId; anchor?: string }
  | { type: "research"; boardId?: string }
  | { type: "tab-steward" };

export interface PaletteResultState {
  id: string;
  kind: "tab" | "bookmark" | "history" | "conversation" | "research" | "bundle" | "setting" | "command" | "recall";
  label: string;
  detail: string;
  score: number;
  action: PaletteActionState;
}

export type PaletteActionState =
  | { type: "select-tab"; tabId: string }
  | { type: "open-url"; url: string }
  | { type: "select-conversation"; sessionId: string }
  | { type: "open-research"; boardId: string }
  | { type: "open-bundle"; bundleId: string }
  | { type: "open-settings" }
  | { type: "open-settings-section"; section: SettingsPageId; anchor?: string | undefined }
  | { type: "set-sidebar-section"; section: SidebarSection }
  | { type: "toggle-work" }
  | { type: "toggle-split" }
  | { type: "toggle-reader" }
  | { type: "toggle-tab-mute"; tabId: string }
  | { type: "open-tab-steward" }
  | { type: "new-research" }
  | { type: "open-walrus-memory" }
  | { type: "start-recording" };

export interface SpeechSettings {
  engine: SpeechEngine;
  language: string;
  customBaseUrl?: string;
  customModel?: string;
  localModelStatus: "missing" | "downloading" | "ready" | "error";
  localModelProgress?: number;
  message?: string;
}

export interface RecordingSourceState {
  tabAudio: boolean;
  microphone: boolean;
}

export interface TranscriptSegment {
  id: string;
  recordingId: string;
  source: "tab" | "microphone";
  startMs: number;
  endMs: number;
  text: string;
  tabId?: string;
}

export interface RecordingTranscriptSummary {
  id: string;
  workSessionId: string;
  startedAt: number;
  endedAt?: number;
  durationMs: number;
  segmentCount: number;
  videoPath?: string;
}

export interface RecordingSessionState {
  status: "idle" | "starting" | "recording" | "paused" | "stopping" | "error";
  id?: string;
  startedAt?: number;
  elapsedMs: number;
  sources: RecordingSourceState;
  saveVideo: boolean;
  activeTabId?: string;
  pausedReason?: string;
  transcriptPreview: TranscriptSegment[];
  transcripts: RecordingTranscriptSummary[];
  engine: SpeechEngine;
  error?: string;
}

export type { BrowserObservationContext };

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
  reasoningText?: string;
  streaming?: boolean;
}

export interface WorkActivityState {
  phase: "idle" | "thinking" | "tool" | "responding";
  label: string;
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

export interface ChatGPTUsageWindowState {
  id: string;
  label: string;
  usedPercent: number;
  windowDurationMinutes?: number;
  resetsAt?: number;
  reached: boolean;
}

export interface ChatGPTUsageState {
  windows: ChatGPTUsageWindowState[];
}

export interface ChatGPTAccountState {
  email?: string;
  plan?: string;
  runtimeVersion?: string;
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
  account?: ChatGPTAccountState;
  usage?: ChatGPTUsageState;
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
  activity: WorkActivityState;
  messages: WorkMessage[];
  conversations: WorkConversationState[];
  attachments: WorkAttachmentState[];
  portableMemory: PortableMemoryAttachmentState[];
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
  splitView: SplitViewState;
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
  configuredSyncServiceUrl?: string;
  remoteTabs: RemoteTabState[];
  onboardingRequired: boolean;
  settingsOpen: boolean;
  paletteOpen: boolean;
  internalSurface?: InternalSurfaceState;
  settings: BrowserSettingsState;
  activePageBookmarked: boolean;
  find: FindState;
  zoomFactor: number;
  workOpen: boolean;
  workWidth: number;
  workOverlay: boolean;
  searchEngine: SearchEngine;
  recording: RecordingSessionState;
  semanticRecall: SemanticRecallState;
  walrusMemory: WalrusMemoryState;
  research: ResearchState;
  tabSteward: TabStewardState;
  reader: ReaderState;
  work: WorkState;
}

export type ShellWorkState = Pick<
  WorkState,
  "sessionId" | "runtime" | "busy" | "conversations" | "model" | "pendingPermission"
>;

/** State published only to the trusted browser-chrome renderer. */
export type ShellState = Omit<BrowserAppState, "work"> & {
  work: ShellWorkState;
};

/** State published only to the trusted Work renderer. */
export interface WorkDockState {
  activeTabGrants: BrowserTabState["grants"];
  recording: RecordingSessionState;
  settings: Pick<BrowserSettingsState, "appearance" | "accent" | "thinkingVisibility" | "toolActivityVisibility">;
  walrusMemory: WalrusMemoryState;
  work: WorkState;
  workWidth: number;
}
