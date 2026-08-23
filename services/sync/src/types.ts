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

export interface SyncRepository {
  authenticate(tokenHash: string): Promise<AuthenticatedDevice | undefined>;
  push(device: AuthenticatedDevice, keyVersion: number, records: OpaqueSyncRecord[]): Promise<{ cursor: number; accepted: number }>;
  pull(accountId: string, cursor: number, limit: number): Promise<{ records: CursorRecord[]; cursor: number; hasMore: boolean }>;
  createEnrollment(enrollment: Enrollment): Promise<void>;
  enrollmentDetails(enrollmentId: string, codeHash: string): Promise<Pick<Enrollment, "deviceId" | "deviceName" | "publicKey" | "expiresAt"> | undefined>;
  approveEnrollment(accountId: string, enrollmentId: string, codeHash: string, wrappedAccountKey: string, deviceToken: string, tokenHash: string): Promise<void>;
  takeEnrollment(enrollmentId: string, codeHash: string): Promise<{ accountId: string; deviceId: string; wrappedAccountKey: string; deviceToken: string; keyVersion: number } | undefined>;
  createPasskeyCeremony(ceremony: PasskeyCeremony): Promise<void>;
  passkeyCeremony(id: string): Promise<PasskeyCeremony | undefined>;
  consumePasskeyCeremony(id: string, kind: PasskeyCeremony["kind"]): Promise<PasskeyCeremony | undefined>;
  createAccountWithPasskey(accountId: string, passkey: StoredPasskey, device: RegisteredDevice): Promise<void>;
  passkey(credentialId: string): Promise<StoredPasskey | undefined>;
  authenticateWithPasskey(credentialId: string, counter: number, device: RegisteredDevice): Promise<void>;
  createPasskeyClaim(claim: PasskeyClaim): Promise<void>;
  takePasskeyClaim(id: string, codeHash: string): Promise<{ accountId: string; deviceId: string; deviceToken: string } | undefined>;
  listDevices(accountId: string): Promise<SyncDevice[]>;
  accountKeyState(accountId: string, deviceId: string): Promise<{ version: number; wrappedAccountKey?: string }>;
  initializeAccountKey(accountId: string, expectedVersion: number, version: number, wraps: AccountKeyWrap[]): Promise<void>;
  setDeviceWrappedKey(accountId: string, deviceId: string, version: number, wrappedAccountKey: string): Promise<void>;
  rotateAccountKey(device: AuthenticatedDevice, expectedVersion: number, version: number, wraps: AccountKeyWrap[], records: OpaqueSyncRecord[]): Promise<{ cursor: number }>;
  cleanupExpired(now: number): Promise<void>;
  revokeDevice(accountId: string, deviceId: string): Promise<void>;
  deleteCloudData(accountId: string): Promise<void>;
  deleteAccount(accountId: string): Promise<void>;
}
