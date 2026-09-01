export interface StoredTab {
  id: string;
  windowId: string;
  profileId: string;
  position: number;
  url: string;
  title: string;
  active: boolean;
  muted: boolean;
  pinned: boolean;
  private: boolean;
  groupId?: string;
}

export interface StoredWindow {
  id: string;
  profileId: string;
  sidebarOpen: boolean;
  workOpen: boolean;
  workWidth: number;
  splitEnabled?: boolean;
  splitRatio?: number;
  primaryTabId?: string;
  secondaryTabId?: string;
  focusedPane?: "primary" | "secondary";
}

export interface StoredCredential {
  id: string;
  origin: string;
  username: string;
  encryptedPassword: Uint8Array;
  updatedAt?: number;
}

export interface StoredCredentialMetadata {
  id: string;
  origin: string;
  username: string;
  updatedAt: number;
}

export interface StoredBookmark {
  id: string;
  title: string;
  url: string;
  createdAt: number;
  updatedAt: number;
}

export interface StoredHistoryEntry {
  id: string;
  title: string;
  url: string;
  visitedAt: number;
}

export interface StoredDownload {
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

export interface StoredProfile {
  id: string;
  name: string;
  partitionName: string;
  createdAt: number;
}

export interface StoredTabGroup {
  id: string;
  windowId: string;
  profileId: string;
  name: string;
  color: string;
  collapsed: boolean;
  position: number;
}

export interface StoredSitePermission {
  origin: string;
  permission: string;
  decision: "allow" | "deny";
  updatedAt: number;
}

export interface StoredExtensionInstall {
  id: string;
  runtimeId?: string;
  name: string;
  version: string;
  enabled: boolean;
  source: "gallery" | "developer";
  installPath?: string;
  manifestJson: string;
  lastError?: string;
  updatedAt?: number;
}

export interface StoredExtensionPackage {
  extensionId: string;
  version: string;
  installPath: string;
  packageFingerprint: string;
  publisherFingerprint: string;
  galleryFingerprint: string;
  installedAt: number;
}

export type BrowserSyncCollection = "bookmarks" | "history" | "tab-groups" | "remote-tabs" | "settings" | "extensions";

export interface StoredSyncAccount {
  profileId: string;
  serviceUrl: string;
  accountId: string;
  deviceId: string;
  devicePublicKey: string;
  encryptedDevicePrivateKey: Uint8Array;
  encryptedDeviceToken: Uint8Array;
  encryptedAccountKey: Uint8Array;
  keyVersion: number;
  status: "connected" | "syncing" | "error";
  lastSyncedAt?: number;
  lastError?: string;
}

export interface SyncQueueRecord {
  collection: BrowserSyncCollection;
  recordId: string;
  clock: string;
  tombstone: boolean;
  value: unknown;
}

export interface StoredRemoteTab {
  id: string;
  deviceId: string;
  title: string;
  url: string;
  groupId?: string;
  updatedAt: number;
}

export interface StoredWalrusMemoryReceipt {
  jobId: string;
  blobId?: string;
  namespace: string;
  status: "pending" | "running" | "uploaded" | "done" | "failed" | "not_found" | "timeout";
  createdAt: number;
  updatedAt: number;
}

export interface StoredResearchBundleReceipt {
  id: string;
  boardId: string;
  quiltId: string;
  manifestSha256: string;
  visibility: "public" | "seal-encrypted";
  network: "mainnet" | "testnet";
  epochs: number;
  signerAddress: string;
  filesJson: string;
  createdAt: number;
}

export interface StoredRecordingSession {
  id: string;
  profileId: string;
  workSessionId: string;
  startedAt: number;
  endedAt?: number;
  status: "recording" | "completed" | "interrupted";
  engine: string;
  sourcesJson: string;
  saveVideo: boolean;
  videoPath?: string;
}

export interface StoredRecordingSegment {
  id: string;
  recordingId: string;
  source: "tab" | "microphone";
  startMs: number;
  endMs: number;
  tabId?: string;
  nonce: string;
  ciphertext: string;
}
