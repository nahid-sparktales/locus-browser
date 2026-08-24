import type { OpaqueBlobStore } from "@locus/sync-service/opaque-record-storage";

const MAX_STORED_CIPHERTEXT_BYTES = 3 * 1024 * 1024;
const OBJECT_KEY_PATTERN = /^v1\/[a-f0-9]{32}\/[a-f0-9]{40}\/[a-f0-9]{64}$/;

export interface R2ObjectBodyLike {
  size: number;
  text(): Promise<string>;
}

export interface R2BucketLike {
  put(key: string, value: string, options?: {
    customMetadata?: Record<string, string>;
    httpMetadata?: { cacheControl?: string; contentType?: string };
  }): Promise<unknown>;
  get(key: string): Promise<R2ObjectBodyLike | null>;
  delete(keys: string | string[]): Promise<void>;
}

export class R2OpaqueBlobStore implements OpaqueBlobStore {
  readonly #bucket: R2BucketLike;

  constructor(bucket: R2BucketLike) {
    this.#bucket = bucket;
  }

  async put(key: string, ciphertext: string): Promise<void> {
    assertObjectKey(key);
    if (byteLength(ciphertext) > MAX_STORED_CIPHERTEXT_BYTES) throw new Error("Opaque sync object exceeds its storage limit");
    await this.#bucket.put(key, ciphertext, {
      customMetadata: { "locus-content": "client-encrypted" },
      httpMetadata: { cacheControl: "no-store", contentType: "application/octet-stream" },
    });
  }

  async get(key: string): Promise<string> {
    assertObjectKey(key);
    const object = await this.#bucket.get(key);
    if (!object) throw new Error("Opaque sync object is missing");
    if (object.size > MAX_STORED_CIPHERTEXT_BYTES) throw new Error("Opaque sync object exceeds its storage limit");
    const ciphertext = await object.text();
    if (byteLength(ciphertext) > MAX_STORED_CIPHERTEXT_BYTES) throw new Error("Opaque sync object exceeds its storage limit");
    return ciphertext;
  }

  async delete(keys: readonly string[]): Promise<void> {
    const unique = [...new Set(keys)];
    unique.forEach(assertObjectKey);
    for (let offset = 0; offset < unique.length; offset += 1_000) {
      await this.#bucket.delete(unique.slice(offset, offset + 1_000));
    }
  }
}

function assertObjectKey(key: string): void {
  if (!OBJECT_KEY_PATTERN.test(key)) throw new Error("Invalid opaque sync object key");
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
