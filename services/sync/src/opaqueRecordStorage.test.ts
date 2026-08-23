import { describe, expect, it } from "vitest";
import { OpaqueRecordStorage, opaqueObjectKey, type OpaqueBlobStore } from "./opaqueRecordStorage.js";
import type { OpaqueSyncRecord } from "./types.js";

class MemoryBlobs implements OpaqueBlobStore {
  values = new Map<string, string>();
  async put(key: string, ciphertext: string) { this.values.set(key, ciphertext); }
  async get(key: string) {
    const value = this.values.get(key);
    if (!value) throw new Error("missing");
    return value;
  }
  async delete(keys: readonly string[]) { for (const key of keys) this.values.delete(key); }
}

describe("large opaque sync record storage", () => {
  it("stores only large ciphertext in object storage and restores it exactly", async () => {
    const blobs = new MemoryBlobs();
    const storage = new OpaqueRecordStorage(blobs, 8);
    const record = fixture("ciphertext-large-enough");
    const staged = await storage.stage(record);
    expect(staged.ciphertext).toBeNull();
    expect(staged.objectKey).toMatch(/^v1\/[a-f0-9]{32}\/[a-f0-9]{40}\/[a-f0-9]{64}$/);
    expect(await storage.hydrate(staged)).toBe(record.ciphertext);
    await storage.discard([staged.objectKey, staged.objectKey]);
    expect(blobs.values.size).toBe(0);
  });

  it("keeps small and tombstone records inline and uses opaque deterministic keys", async () => {
    const blobs = new MemoryBlobs();
    const storage = new OpaqueRecordStorage(blobs, 100);
    expect((await storage.stage(fixture("small"))).objectKey).toBeNull();
    expect((await storage.stage({ ...fixture("x".repeat(200)), tombstone: true })).objectKey).toBeNull();
    expect(opaqueObjectKey(fixture("secret-a"))).not.toContain("record-a");
    expect(opaqueObjectKey(fixture("secret-a"))).not.toContain("account-a");
    expect(opaqueObjectKey(fixture("secret-a"))).not.toBe(opaqueObjectKey(fixture("secret-b")));
  });

  it("cleans every successful staged object when any batch upload fails", async () => {
    const blobs = new MemoryBlobs();
    const originalPut = blobs.put.bind(blobs);
    blobs.put = async (key, ciphertext) => {
      if (ciphertext === "fail") throw new Error("object store failed");
      await originalPut(key, ciphertext);
    };
    const storage = new OpaqueRecordStorage(blobs, 1);
    await expect(storage.stageBatch([fixture("first"), fixture("fail"), fixture("third")]))
      .rejects.toThrow("object store failed");
    expect(blobs.values.size).toBe(0);
  });
});

function fixture(ciphertext: string): OpaqueSyncRecord {
  return {
    version: 1,
    accountId: "account-a",
    deviceId: "device-a",
    collection: "bookmarks",
    recordId: "record-a",
    clock: "1787408000000-000001-device-a",
    nonce: "abcdefghijklmnopqrstuvwxyz012345",
    ciphertext,
    tombstone: false,
    size: Buffer.byteLength(ciphertext),
  };
}
