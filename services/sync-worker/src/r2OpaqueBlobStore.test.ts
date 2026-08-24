import { describe, expect, it } from "vitest";
import { R2OpaqueBlobStore, type R2BucketLike, type R2ObjectBodyLike } from "./r2OpaqueBlobStore.js";

class MemoryR2 implements R2BucketLike {
  readonly values = new Map<string, string>();
  readonly deleted: string[][] = [];
  metadata: Record<string, string> | undefined;

  async put(key: string, value: string, options?: { customMetadata?: Record<string, string> }): Promise<void> {
    this.values.set(key, value);
    this.metadata = options?.customMetadata;
  }

  async get(key: string): Promise<R2ObjectBodyLike | null> {
    const value = this.values.get(key);
    return value === undefined ? null : { size: new TextEncoder().encode(value).byteLength, text: async () => value };
  }

  async delete(keys: string | string[]): Promise<void> {
    const batch = Array.isArray(keys) ? keys : [keys];
    this.deleted.push(batch);
    batch.forEach((key) => this.values.delete(key));
  }
}

const key = `v1/${"a".repeat(32)}/${"b".repeat(40)}/${"c".repeat(64)}`;

describe("R2 opaque blob storage", () => {
  it("stores and restores only validated client ciphertext", async () => {
    const bucket = new MemoryR2();
    const store = new R2OpaqueBlobStore(bucket);
    await store.put(key, "opaque-ciphertext");
    expect(await store.get(key)).toBe("opaque-ciphertext");
    expect(bucket.metadata).toEqual({ "locus-content": "client-encrypted" });
  });

  it("rejects non-opaque keys and batches cleanup at the R2 limit", async () => {
    const bucket = new MemoryR2();
    const store = new R2OpaqueBlobStore(bucket);
    await expect(store.put("../escape", "ciphertext")).rejects.toThrow("Invalid opaque sync object key");
    const keys = Array.from({ length: 1_001 }, (_, index) => `v1/${index.toString(16).padStart(32, "0")}/${"b".repeat(40)}/${"c".repeat(64)}`);
    await store.delete(keys);
    expect(bucket.deleted.map((batch) => batch.length)).toEqual([1_000, 1]);
  });
});
