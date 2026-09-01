export interface AuthenticatedDevice {
  accountId: string;
  deviceId: string;
}

export interface OpaqueSyncRecord {
  version: 1;
  accountId: string;
  deviceId: string;
  collection: "bookmarks" | "history" | "tab-groups" | "remote-tabs" | "settings" | "extensions";
  recordId: string;
  clock: string;
  nonce: string;
  ciphertext: string;
  tombstone: boolean;
  size: number;
}

export interface CursorRecord extends OpaqueSyncRecord {
  cursor: number;
}

export interface Enrollment {
  id: string;
  accountId?: string;
  deviceId: string;
  deviceName: string;
  publicKey: string;
  codeHash: string;
  expiresAt: number;
  wrappedAccountKey?: string;
  deviceToken?: string;
}

export interface PasskeyCeremony {
  id: string;
  kind: "register" | "authenticate";
  accountId?: string;
  userId?: string;
  displayName?: string;
  challenge: string;
  optionsJson: string;
  deviceId: string;
  deviceName: string;
  devicePublicKey: string;
  expiresAt: number;
}

export interface StoredPasskey {
  credentialId: string;
  accountId: string;
  userId: string;
  publicKey: string;
  counter: number;
  deviceType: string;
  backedUp: boolean;
  transports: string[];
}

export interface PasskeyClaim {
  id: string;
  codeHash: string;
  accountId: string;
  deviceId: string;
  deviceToken: string;
  expiresAt: number;
}

export interface RegisteredDevice {
  accountId: string;
  deviceId: string;
  name: string;
  publicKey: string;
  tokenHash: string;
  wrappedAccountKey?: string;
  keyVersion: number;
  createdAt: number;
  lastSeenAt: number;
}

export interface SyncDevice {
  deviceId: string;
  name: string;
  publicKey: string;
  keyVersion: number;
  createdAt: number;
  lastSeenAt: number;
}

export interface AccountKeyWrap {
  deviceId: string;
  wrappedAccountKey: string;
}
