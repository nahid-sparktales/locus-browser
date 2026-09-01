import type {
  AccountKeyWrap,
  AuthenticatedDevice,
  CursorRecord,
  Enrollment,
  OpaqueSyncRecord,
  PasskeyCeremony,
  PasskeyClaim,
  RegisteredDevice,
  StoredPasskey,
  SyncDevice,
} from "./models.js";

export interface SyncRecordRepository {
  push(device: AuthenticatedDevice, keyVersion: number, records: OpaqueSyncRecord[]): Promise<{ cursor: number; accepted: number }>;
  pull(accountId: string, cursor: number, limit: number): Promise<{ records: CursorRecord[]; cursor: number; hasMore: boolean }>;
  deleteCloudData(accountId: string): Promise<void>;
}

export interface DeviceRepository {
  authenticate(tokenHash: string): Promise<AuthenticatedDevice | undefined>;
  createEnrollment(enrollment: Enrollment): Promise<void>;
  enrollmentDetails(enrollmentId: string, codeHash: string): Promise<Pick<Enrollment, "deviceId" | "deviceName" | "publicKey" | "expiresAt"> | undefined>;
  approveEnrollment(accountId: string, enrollmentId: string, codeHash: string, wrappedAccountKey: string, deviceToken: string, tokenHash: string): Promise<void>;
  takeEnrollment(enrollmentId: string, codeHash: string): Promise<{ accountId: string; deviceId: string; wrappedAccountKey: string; deviceToken: string; keyVersion: number } | undefined>;
  listDevices(accountId: string): Promise<SyncDevice[]>;
  revokeDevice(accountId: string, deviceId: string): Promise<void>;
}

export interface PasskeyRepository {
  createPasskeyCeremony(ceremony: PasskeyCeremony): Promise<void>;
  passkeyCeremony(id: string): Promise<PasskeyCeremony | undefined>;
  consumePasskeyCeremony(id: string, kind: PasskeyCeremony["kind"]): Promise<PasskeyCeremony | undefined>;
  createAccountWithPasskey(accountId: string, passkey: StoredPasskey, device: RegisteredDevice): Promise<void>;
  passkey(credentialId: string): Promise<StoredPasskey | undefined>;
  authenticateWithPasskey(credentialId: string, counter: number, device: RegisteredDevice): Promise<void>;
  createPasskeyClaim(claim: PasskeyClaim): Promise<void>;
  takePasskeyClaim(id: string, codeHash: string): Promise<{ accountId: string; deviceId: string; deviceToken: string } | undefined>;
}

export interface AccountKeyRepository {
  accountKeyState(accountId: string, deviceId: string): Promise<{ version: number; wrappedAccountKey?: string }>;
  initializeAccountKey(accountId: string, expectedVersion: number, version: number, wraps: AccountKeyWrap[]): Promise<void>;
  setDeviceWrappedKey(accountId: string, deviceId: string, version: number, wrappedAccountKey: string): Promise<void>;
  rotateAccountKey(device: AuthenticatedDevice, expectedVersion: number, version: number, wraps: AccountKeyWrap[], records: OpaqueSyncRecord[]): Promise<{ cursor: number }>;
}

export interface SyncRepository extends SyncRecordRepository, DeviceRepository, PasskeyRepository, AccountKeyRepository {
  cleanupExpired(now: number): Promise<void>;
  deleteAccount(accountId: string): Promise<void>;
}
