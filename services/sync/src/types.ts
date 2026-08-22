export interface AuthenticatedDevice {
  accountId: string;
  deviceId: string;
}

export interface OpaqueSyncRecord {
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
  accountId: string;
  deviceId: string;
  publicKey: string;
  codeHash: string;
  expiresAt: number;
  wrappedAccountKey?: string;
  deviceToken?: string;
}

export interface SyncRepository {
  authenticate(tokenHash: string): Promise<AuthenticatedDevice | undefined>;
  push(device: AuthenticatedDevice, records: OpaqueSyncRecord[]): Promise<number>;
  pull(accountId: string, cursor: number, limit: number): Promise<{ records: CursorRecord[]; cursor: number; hasMore: boolean }>;
  createEnrollment(enrollment: Enrollment): Promise<void>;
  approveEnrollment(accountId: string, enrollmentId: string, wrappedAccountKey: string, deviceToken: string, tokenHash: string): Promise<void>;
  takeEnrollment(enrollmentId: string, codeHash: string): Promise<{ wrappedAccountKey: string; deviceToken: string } | undefined>;
  revokeDevice(accountId: string, deviceId: string): Promise<void>;
  deleteCloudData(accountId: string): Promise<void>;
  deleteAccount(accountId: string): Promise<void>;
}
