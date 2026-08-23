import { DeleteObjectsCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { OpaqueBlobStore } from "./opaqueRecordStorage.js";

const MAX_STORED_CIPHERTEXT_BYTES = 3 * 1024 * 1024;

interface S3Like {
  send(command: unknown): Promise<any>;
}

export interface S3OpaqueBlobStoreOptions {
  bucket: string;
  endpoint?: string;
  region?: string;
  forcePathStyle?: boolean;
  client?: S3Like;
}

export class S3OpaqueBlobStore implements OpaqueBlobStore {
  readonly #bucket: string;
  readonly #client: S3Like;

  constructor(options: S3OpaqueBlobStoreOptions) {
    if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(options.bucket)) throw new Error("Invalid sync object bucket");
    this.#bucket = options.bucket;
    this.#client = options.client ?? new S3Client({
      region: options.region || "us-east-1",
      ...(options.endpoint ? { endpoint: options.endpoint } : {}),
      forcePathStyle: options.forcePathStyle ?? Boolean(options.endpoint),
    });
  }

  async put(key: string, ciphertext: string): Promise<void> {
    await this.#client.send(new PutObjectCommand({
      Bucket: this.#bucket,
      Key: key,
      Body: Buffer.from(ciphertext, "utf8"),
      ContentType: "application/octet-stream",
      CacheControl: "no-store",
      ServerSideEncryption: "AES256",
      Metadata: { "locus-content": "client-encrypted" },
    }));
  }

  async get(key: string): Promise<string> {
    const response = await this.#client.send(new GetObjectCommand({ Bucket: this.#bucket, Key: key }));
    if (!response.Body) throw new Error("Opaque sync object is missing");
    if (Number(response.ContentLength ?? 0) > MAX_STORED_CIPHERTEXT_BYTES) throw new Error("Opaque sync object exceeds its storage limit");
    if (!(Symbol.asyncIterator in response.Body)) throw new Error("Opaque sync object returned an unsupported body");
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of response.Body as AsyncIterable<Uint8Array | string>) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += bytes.byteLength;
      if (total > MAX_STORED_CIPHERTEXT_BYTES) throw new Error("Opaque sync object exceeds its storage limit");
      chunks.push(bytes);
    }
    return Buffer.concat(chunks, total).toString("utf8");
  }

  async delete(keys: readonly string[]): Promise<void> {
    for (let offset = 0; offset < keys.length; offset += 1_000) {
      const batch = keys.slice(offset, offset + 1_000);
      const response = await this.#client.send(new DeleteObjectsCommand({
        Bucket: this.#bucket,
        Delete: { Quiet: true, Objects: batch.map((Key) => ({ Key })) },
      }));
      if (Array.isArray(response.Errors) && response.Errors.length) {
        throw new Error(`Opaque sync object cleanup failed for ${response.Errors.length} object(s)`);
      }
    }
  }
}
