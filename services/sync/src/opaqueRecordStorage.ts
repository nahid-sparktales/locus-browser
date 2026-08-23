import { createHash } from "node:crypto";
import type { OpaqueSyncRecord } from "./types.js";

export const LARGE_OPAQUE_RECORD_THRESHOLD = 256 * 1024;

export interface OpaqueBlobStore {
  put(key: string, ciphertext: string): Promise<void>;
  get(key: string): Promise<string>;
  delete(keys: readonly string[]): Promise<void>;
}

export interface StoredOpaquePayload {
  ciphertext: string | null;
  objectKey: string | null;
}

export class OpaqueRecordStorage {
  readonly #blobs: OpaqueBlobStore | undefined;
  readonly #threshold: number;

  constructor(blobs?: OpaqueBlobStore, threshold = LARGE_OPAQUE_RECORD_THRESHOLD) {
    this.#blobs = blobs;
    this.#threshold = threshold;
  }

  async stage(record: OpaqueSyncRecord): Promise<StoredOpaquePayload> {
    if (!this.#blobs || record.tombstone || record.size < this.#threshold) {
      return { ciphertext: record.ciphertext, objectKey: null };
    }
    const objectKey = opaqueObjectKey(record);
    await this.#blobs.put(objectKey, record.ciphertext);
    return { ciphertext: null, objectKey };
  }

  async stageBatch(records: readonly OpaqueSyncRecord[]): Promise<StoredOpaquePayload[]> {
    const results = await Promise.allSettled(records.map((record) => this.stage(record)));
    const staged = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
    const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failure) {
      await this.discard(staged.map((payload) => payload.objectKey)).catch(() => undefined);
      throw failure.reason;
    }
    return staged;
  }

  async hydrate(payload: StoredOpaquePayload): Promise<string> {
    if (payload.ciphertext !== null) return payload.ciphertext;
    if (!payload.objectKey || !this.#blobs) throw new Error("Opaque sync object storage is unavailable");
    return await this.#blobs.get(payload.objectKey);
  }

  async discard(keys: readonly (string | null | undefined)[]): Promise<void> {
    if (!this.#blobs) return;
    const unique = [...new Set(keys.filter((key): key is string => Boolean(key)))];
    if (unique.length) await this.#blobs.delete(unique);
  }
}

export function opaqueObjectKey(record: Pick<OpaqueSyncRecord, "accountId" | "collection" | "recordId" | "clock" | "ciphertext">): string {
  const account = digest(record.accountId).slice(0, 32);
  const identity = digest(`${record.collection}\0${record.recordId}`).slice(0, 40);
  const revision = digest(`${record.clock}\0${record.ciphertext}`);
  return `v1/${account}/${identity}/${revision}`;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
