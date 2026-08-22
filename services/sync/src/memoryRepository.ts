import type { AuthenticatedDevice, CursorRecord, Enrollment, OpaqueSyncRecord, SyncRepository } from "./types.js";

export class MemorySyncRepository implements SyncRepository {
  readonly #tokens = new Map<string, AuthenticatedDevice>();
  readonly #records = new Map<string, CursorRecord>();
  readonly #enrollments = new Map<string, Enrollment>();
  #cursor = 0;

  enrollToken(tokenHash: string, device: AuthenticatedDevice): void {
    this.#tokens.set(tokenHash, device);
  }

  async authenticate(tokenHash: string): Promise<AuthenticatedDevice | undefined> {
    return this.#tokens.get(tokenHash);
  }

  async push(device: AuthenticatedDevice, records: OpaqueSyncRecord[]): Promise<number> {
    for (const record of records) {
      if (record.accountId !== device.accountId || record.deviceId !== device.deviceId) throw new Error("Record ownership mismatch");
      const key = `${device.accountId}:${record.collection}:${record.recordId}`;
      const existing = this.#records.get(key);
      if (existing && existing.clock >= record.clock) continue;
      this.#cursor += 1;
      this.#records.set(key, { ...record, cursor: this.#cursor });
    }
    return this.#cursor;
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

  async revokeDevice(accountId: string, deviceId: string): Promise<void> {
    for (const [hash, device] of this.#tokens) if (device.accountId === accountId && device.deviceId === deviceId) this.#tokens.delete(hash);
  }

  async deleteCloudData(accountId: string): Promise<void> {
    for (const [key, record] of this.#records) if (record.accountId === accountId) this.#records.delete(key);
  }

  async deleteAccount(accountId: string): Promise<void> {
    await this.deleteCloudData(accountId);
    for (const [hash, device] of this.#tokens) if (device.accountId === accountId) this.#tokens.delete(hash);
    for (const [id, enrollment] of this.#enrollments) if (enrollment.accountId === accountId) this.#enrollments.delete(id);
  }
}
