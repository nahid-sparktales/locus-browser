import type {
  AuthenticatedDevice,
  AccountKeyWrap,
  CursorRecord,
  Enrollment,
  OpaqueSyncRecord,
  PasskeyCeremony,
  PasskeyClaim,
  RegisteredDevice,
  SyncDevice,
  StoredPasskey,
  SyncRepository,
} from "./types.js";

export class MemorySyncRepository implements SyncRepository {
  readonly #tokens = new Map<string, AuthenticatedDevice>();
  readonly #devices = new Map<string, RegisteredDevice>();
  readonly #keyVersions = new Map<string, number>();
  readonly #records = new Map<string, CursorRecord>();
  readonly #recordUpdatedAt = new Map<string, number>();
  readonly #enrollments = new Map<string, Enrollment>();
  readonly #ceremonies = new Map<string, PasskeyCeremony>();
  readonly #passkeys = new Map<string, StoredPasskey>();
  readonly #claims = new Map<string, PasskeyClaim>();
  #cursor = 0;

  enrollToken(tokenHash: string, device: AuthenticatedDevice): void {
    this.#tokens.set(tokenHash, device);
    const now = Date.now();
    this.#devices.set(deviceKey(device.accountId, device.deviceId), {
      ...device,
      name: "Development device",
      publicKey: "development-bootstrap",
      tokenHash,
      keyVersion: 1,
      createdAt: now,
      lastSeenAt: now,
    });
    this.#keyVersions.set(device.accountId, 1);
  }

  async authenticate(tokenHash: string): Promise<AuthenticatedDevice | undefined> {
    const authenticated = this.#tokens.get(tokenHash);
    if (authenticated) {
      const device = this.#devices.get(deviceKey(authenticated.accountId, authenticated.deviceId));
      if (device) device.lastSeenAt = Date.now();
    }
    return authenticated;
  }

  async push(device: AuthenticatedDevice, keyVersion: number, records: OpaqueSyncRecord[]): Promise<{ cursor: number; accepted: number }> {
    if (this.#keyVersions.get(device.accountId) !== keyVersion) throw new Error("Sync account key version changed");
    let accepted = 0;
    for (const record of records) {
      if (record.accountId !== device.accountId || record.deviceId !== device.deviceId) throw new Error("Record ownership mismatch");
      const key = `${device.accountId}:${record.collection}:${record.recordId}`;
      const existing = this.#records.get(key);
      if (existing && existing.clock >= record.clock) continue;
      this.#cursor += 1;
      this.#records.set(key, { ...record, cursor: this.#cursor });
      this.#recordUpdatedAt.set(key, Date.now());
      accepted += 1;
    }
    return { cursor: this.#cursor, accepted };
  }

  async pull(accountId: string, cursor: number, limit: number) {
    const available = [...this.#records.values()]
      .filter((record) => record.accountId === accountId && record.cursor > cursor)
      .sort((left, right) => left.cursor - right.cursor);
    const records = available.slice(0, limit);
    return { records, cursor: records.at(-1)?.cursor ?? cursor, hasMore: available.length > records.length };
  }

  async createEnrollment(enrollment: Enrollment): Promise<void> {
    this.#enrollments.set(enrollment.id, enrollment);
  }

  async enrollmentDetails(enrollmentId: string, codeHash: string) {
    const enrollment = this.#enrollments.get(enrollmentId);
    if (!enrollment || enrollment.codeHash !== codeHash || enrollment.expiresAt < Date.now() || enrollment.wrappedAccountKey) return undefined;
    return {
      deviceId: enrollment.deviceId,
      deviceName: enrollment.deviceName,
      publicKey: enrollment.publicKey,
      expiresAt: enrollment.expiresAt,
    };
  }

  async approveEnrollment(accountId: string, enrollmentId: string, codeHash: string, wrappedAccountKey: string, deviceToken: string, tokenHash: string): Promise<void> {
    const enrollment = this.#enrollments.get(enrollmentId);
    if (!enrollment || enrollment.codeHash !== codeHash || enrollment.expiresAt < Date.now() || enrollment.wrappedAccountKey) throw new Error("Enrollment is unavailable");
    const keyVersion = this.#keyVersions.get(accountId);
    if (!keyVersion) throw new Error("Sync account key is not initialized");
    enrollment.accountId = accountId;
    enrollment.wrappedAccountKey = wrappedAccountKey;
    enrollment.deviceToken = deviceToken;
    this.#tokens.set(tokenHash, { accountId, deviceId: enrollment.deviceId });
    const now = Date.now();
    this.#devices.set(deviceKey(accountId, enrollment.deviceId), {
      accountId,
      deviceId: enrollment.deviceId,
      name: enrollment.deviceName,
      publicKey: enrollment.publicKey,
      tokenHash,
      wrappedAccountKey,
      keyVersion,
      createdAt: now,
      lastSeenAt: now,
    });
  }

  async takeEnrollment(enrollmentId: string, codeHash: string) {
    const enrollment = this.#enrollments.get(enrollmentId);
    if (!enrollment || enrollment.codeHash !== codeHash || enrollment.expiresAt < Date.now() || !enrollment.wrappedAccountKey || !enrollment.deviceToken) return undefined;
    this.#enrollments.delete(enrollmentId);
    if (!enrollment.accountId) return undefined;
    return {
      accountId: enrollment.accountId,
      deviceId: enrollment.deviceId,
      wrappedAccountKey: enrollment.wrappedAccountKey,
      deviceToken: enrollment.deviceToken,
      keyVersion: this.#keyVersions.get(enrollment.accountId) ?? 0,
    };
  }

  async createPasskeyCeremony(ceremony: PasskeyCeremony): Promise<void> {
    this.#ceremonies.set(ceremony.id, ceremony);
  }

  async passkeyCeremony(id: string): Promise<PasskeyCeremony | undefined> {
    const ceremony = this.#ceremonies.get(id);
    return ceremony && ceremony.expiresAt >= Date.now() ? ceremony : undefined;
  }

  async consumePasskeyCeremony(id: string, kind: PasskeyCeremony["kind"]): Promise<PasskeyCeremony | undefined> {
    const ceremony = await this.passkeyCeremony(id);
    if (!ceremony || ceremony.kind !== kind) return undefined;
    this.#ceremonies.delete(id);
    return ceremony;
  }

  async createAccountWithPasskey(accountId: string, passkey: StoredPasskey, device: RegisteredDevice): Promise<void> {
    if (passkey.accountId !== accountId || device.accountId !== accountId) throw new Error("Passkey account mismatch");
    if (this.#passkeys.has(passkey.credentialId)) throw new Error("Passkey is already registered");
    this.#passkeys.set(passkey.credentialId, passkey);
    this.#tokens.set(device.tokenHash, { accountId, deviceId: device.deviceId });
    this.#devices.set(deviceKey(accountId, device.deviceId), device);
    this.#keyVersions.set(accountId, 0);
  }

  async passkey(credentialId: string): Promise<StoredPasskey | undefined> {
    return this.#passkeys.get(credentialId);
  }

  async authenticateWithPasskey(credentialId: string, counter: number, device: RegisteredDevice): Promise<void> {
    const passkey = this.#passkeys.get(credentialId);
    if (!passkey || passkey.accountId !== device.accountId) throw new Error("Passkey is unavailable");
    passkey.counter = counter;
    this.#tokens.set(device.tokenHash, { accountId: device.accountId, deviceId: device.deviceId });
    this.#devices.set(deviceKey(device.accountId, device.deviceId), device);
  }

  async createPasskeyClaim(claim: PasskeyClaim): Promise<void> {
    this.#claims.set(claim.id, claim);
  }

  async cleanupExpired(now: number): Promise<void> {
    const tombstoneCutoff = now - 90 * 24 * 60 * 60 * 1_000;
    for (const [key, record] of this.#records) {
      if (record.tombstone && (this.#recordUpdatedAt.get(key) ?? now) < tombstoneCutoff) {
        this.#records.delete(key);
        this.#recordUpdatedAt.delete(key);
      }
    }
    for (const [id, enrollment] of this.#enrollments) if (enrollment.expiresAt < now) this.#enrollments.delete(id);
    for (const [id, ceremony] of this.#ceremonies) if (ceremony.expiresAt < now) this.#ceremonies.delete(id);
    for (const [id, claim] of this.#claims) if (claim.expiresAt < now) this.#claims.delete(id);
  }

  async takePasskeyClaim(id: string, codeHash: string) {
    const claim = this.#claims.get(id);
    if (!claim || claim.codeHash !== codeHash || claim.expiresAt < Date.now()) return undefined;
    this.#claims.delete(id);
    return { accountId: claim.accountId, deviceId: claim.deviceId, deviceToken: claim.deviceToken };
  }

  async listDevices(accountId: string): Promise<SyncDevice[]> {
    return [...this.#devices.values()]
      .filter((device) => device.accountId === accountId)
      .map(({ deviceId, name, publicKey, keyVersion, createdAt, lastSeenAt }) => ({ deviceId, name, publicKey, keyVersion, createdAt, lastSeenAt }))
      .sort((left, right) => right.lastSeenAt - left.lastSeenAt);
  }

  async accountKeyState(accountId: string, deviceId: string): Promise<{ version: number; wrappedAccountKey?: string }> {
    const device = this.#devices.get(deviceKey(accountId, deviceId));
    if (!device) throw new Error("Device is unavailable");
    const version = this.#keyVersions.get(accountId) ?? 0;
    return { version, ...(device.keyVersion === version && device.wrappedAccountKey ? { wrappedAccountKey: device.wrappedAccountKey } : {}) };
  }

  async initializeAccountKey(accountId: string, expectedVersion: number, version: number, wraps: AccountKeyWrap[]): Promise<void> {
    if ((this.#keyVersions.get(accountId) ?? 0) !== expectedVersion || version !== expectedVersion + 1) throw new Error("Sync account key version changed");
    const devices = [...this.#devices.values()].filter((device) => device.accountId === accountId);
    assertCompleteWrapSet(devices, wraps);
    this.#keyVersions.set(accountId, version);
    for (const wrap of wraps) {
      const device = this.#devices.get(deviceKey(accountId, wrap.deviceId))!;
      device.wrappedAccountKey = wrap.wrappedAccountKey;
      device.keyVersion = version;
    }
  }

  async setDeviceWrappedKey(accountId: string, deviceId: string, version: number, wrappedAccountKey: string): Promise<void> {
    if (this.#keyVersions.get(accountId) !== version) throw new Error("Sync account key version changed");
    const device = this.#devices.get(deviceKey(accountId, deviceId));
    if (!device) throw new Error("Device is unavailable");
    device.wrappedAccountKey = wrappedAccountKey;
    device.keyVersion = version;
  }

  async rotateAccountKey(device: AuthenticatedDevice, expectedVersion: number, version: number, wraps: AccountKeyWrap[], records: OpaqueSyncRecord[]): Promise<{ cursor: number }> {
    if (this.#keyVersions.get(device.accountId) !== expectedVersion || version !== expectedVersion + 1) throw new Error("Sync account key version changed");
    const devices = [...this.#devices.values()].filter((entry) => entry.accountId === device.accountId);
    assertCompleteWrapSet(devices, wraps);
    const existingKeys = new Set([...this.#records.values()].filter((record) => record.accountId === device.accountId).map(recordKey));
    const replacementKeys = new Set(records.map(recordKey));
    if (existingKeys.size !== replacementKeys.size || [...existingKeys].some((key) => !replacementKeys.has(key))) throw new Error("Key rotation must replace every sync record");
    if (records.some((record) => record.accountId !== device.accountId || record.deviceId !== device.deviceId)) throw new Error("Record ownership mismatch");
    for (const [key, record] of this.#records) if (record.accountId === device.accountId) {
      this.#records.delete(key);
      this.#recordUpdatedAt.delete(key);
    }
    for (const record of records) {
      this.#cursor += 1;
      const key = `${device.accountId}:${record.collection}:${record.recordId}`;
      this.#records.set(key, { ...record, cursor: this.#cursor });
      this.#recordUpdatedAt.set(key, Date.now());
    }
    this.#keyVersions.set(device.accountId, version);
    for (const wrap of wraps) {
      const target = this.#devices.get(deviceKey(device.accountId, wrap.deviceId))!;
      target.wrappedAccountKey = wrap.wrappedAccountKey;
      target.keyVersion = version;
    }
    return { cursor: this.#cursor };
  }

  async revokeDevice(accountId: string, deviceId: string): Promise<void> {
    for (const [hash, device] of this.#tokens) if (device.accountId === accountId && device.deviceId === deviceId) this.#tokens.delete(hash);
    this.#devices.delete(deviceKey(accountId, deviceId));
  }

  async deleteCloudData(accountId: string): Promise<void> {
    for (const [key, record] of this.#records) if (record.accountId === accountId) {
      this.#records.delete(key);
      this.#recordUpdatedAt.delete(key);
    }
  }

  async deleteAccount(accountId: string): Promise<void> {
    await this.deleteCloudData(accountId);
    for (const [hash, device] of this.#tokens) if (device.accountId === accountId) this.#tokens.delete(hash);
    for (const [id, enrollment] of this.#enrollments) if (enrollment.accountId === accountId) this.#enrollments.delete(id);
    for (const [id, ceremony] of this.#ceremonies) if (ceremony.accountId === accountId) this.#ceremonies.delete(id);
    for (const [id, passkey] of this.#passkeys) if (passkey.accountId === accountId) this.#passkeys.delete(id);
    for (const [id, claim] of this.#claims) if (claim.accountId === accountId) this.#claims.delete(id);
    for (const key of this.#devices.keys()) if (key.startsWith(`${accountId}:`)) this.#devices.delete(key);
    this.#keyVersions.delete(accountId);
  }
}

function deviceKey(accountId: string, deviceId: string): string {
  return `${accountId}:${deviceId}`;
}

function recordKey(record: Pick<OpaqueSyncRecord, "collection" | "recordId">): string {
  return `${record.collection}:${record.recordId}`;
}

function assertCompleteWrapSet(devices: RegisteredDevice[], wraps: AccountKeyWrap[]): void {
  const deviceIds = new Set(devices.map((device) => device.deviceId));
  const wrapIds = new Set(wraps.map((wrap) => wrap.deviceId));
  if (wrapIds.size !== wraps.length || deviceIds.size !== wrapIds.size || [...deviceIds].some((id) => !wrapIds.has(id))) {
    throw new Error("Every active device requires exactly one wrapped account key");
  }
}
