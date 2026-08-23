import type {
  AuthenticatedDevice,
  CursorRecord,
  Enrollment,
  OpaqueSyncRecord,
  PasskeyCeremony,
  PasskeyClaim,
  RegisteredDevice,
  StoredPasskey,
  SyncRepository,
} from "./types.js";

export class MemorySyncRepository implements SyncRepository {
  readonly #tokens = new Map<string, AuthenticatedDevice>();
  readonly #records = new Map<string, CursorRecord>();
  readonly #recordUpdatedAt = new Map<string, number>();
  readonly #enrollments = new Map<string, Enrollment>();
  readonly #ceremonies = new Map<string, PasskeyCeremony>();
  readonly #passkeys = new Map<string, StoredPasskey>();
  readonly #claims = new Map<string, PasskeyClaim>();
  #cursor = 0;

  enrollToken(tokenHash: string, device: AuthenticatedDevice): void {
    this.#tokens.set(tokenHash, device);
  }

  async authenticate(tokenHash: string): Promise<AuthenticatedDevice | undefined> {
    return this.#tokens.get(tokenHash);
  }

  async push(device: AuthenticatedDevice, records: OpaqueSyncRecord[]): Promise<{ cursor: number; accepted: number }> {
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

  async approveEnrollment(accountId: string, enrollmentId: string, wrappedAccountKey: string, deviceToken: string, tokenHash: string): Promise<void> {
    const enrollment = this.#enrollments.get(enrollmentId);
    if (!enrollment || enrollment.accountId !== accountId || enrollment.expiresAt < Date.now()) throw new Error("Enrollment is unavailable");
    enrollment.wrappedAccountKey = wrappedAccountKey;
    enrollment.deviceToken = deviceToken;
    this.#tokens.set(tokenHash, { accountId, deviceId: enrollment.deviceId });
  }

  async takeEnrollment(enrollmentId: string, codeHash: string) {
    const enrollment = this.#enrollments.get(enrollmentId);
    if (!enrollment || enrollment.codeHash !== codeHash || enrollment.expiresAt < Date.now() || !enrollment.wrappedAccountKey || !enrollment.deviceToken) return undefined;
    this.#enrollments.delete(enrollmentId);
    return { wrappedAccountKey: enrollment.wrappedAccountKey, deviceToken: enrollment.deviceToken };
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
  }

  async passkey(credentialId: string): Promise<StoredPasskey | undefined> {
    return this.#passkeys.get(credentialId);
  }

  async authenticateWithPasskey(credentialId: string, counter: number, device: RegisteredDevice): Promise<void> {
    const passkey = this.#passkeys.get(credentialId);
    if (!passkey || passkey.accountId !== device.accountId) throw new Error("Passkey is unavailable");
    passkey.counter = counter;
    this.#tokens.set(device.tokenHash, { accountId: device.accountId, deviceId: device.deviceId });
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

  async revokeDevice(accountId: string, deviceId: string): Promise<void> {
    for (const [hash, device] of this.#tokens) if (device.accountId === accountId && device.deviceId === deviceId) this.#tokens.delete(hash);
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
  }
}
