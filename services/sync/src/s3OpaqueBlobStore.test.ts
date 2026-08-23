import { DeleteObjectsCommand, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";
import { S3OpaqueBlobStore } from "./s3OpaqueBlobStore.js";

describe("S3 opaque blob store", () => {
  it("stores client ciphertext with no public cache and batches deletion", async () => {
    const commands: unknown[] = [];
    const client = {
      async send(command: unknown) {
        commands.push(command);
        if (command instanceof GetObjectCommand) {
          return { Body: asyncBody([Buffer.from("opaque-ciphertext")]) };
        }
        return {};
      },
    };
    const store = new S3OpaqueBlobStore({ bucket: "locus-sync-opaque", client });
    await store.put("v1/account/record/revision", "opaque-ciphertext");
    expect((commands[0] as PutObjectCommand).input).toMatchObject({
      Bucket: "locus-sync-opaque",
      Key: "v1/account/record/revision",
      CacheControl: "no-store",
      ServerSideEncryption: "AES256",
      Metadata: { "locus-content": "client-encrypted" },
    });
    expect(await store.get("v1/account/record/revision")).toBe("opaque-ciphertext");
    await store.delete(Array.from({ length: 1_001 }, (_, index) => `v1/key-${index}`));
    const deletes = commands.filter((command) => command instanceof DeleteObjectsCommand) as DeleteObjectsCommand[];
    expect(deletes).toHaveLength(2);
    expect(deletes[0]!.input.Delete?.Objects).toHaveLength(1_000);
    expect(deletes[1]!.input.Delete?.Objects).toHaveLength(1);
  });

  it("rejects unsafe bucket names", () => {
    expect(() => new S3OpaqueBlobStore({ bucket: "UPPER CASE", client: { send: async () => ({}) } })).toThrow("Invalid sync object bucket");
  });

  it("bounds object bodies even when object metadata is missing", async () => {
    const oversized = Buffer.alloc(3 * 1024 * 1024 + 1);
    const store = new S3OpaqueBlobStore({
      bucket: "locus-sync-opaque",
      client: { send: async () => ({ Body: asyncBody([oversized]) }) },
    });
    await expect(store.get("v1/oversized")).rejects.toThrow("storage limit");
  });

  it("reports partial object-store cleanup failures", async () => {
    const store = new S3OpaqueBlobStore({
      bucket: "locus-sync-opaque",
      client: { send: async () => ({ Errors: [{ Key: "v1/failed", Code: "InternalError" }] }) },
    });
    await expect(store.delete(["v1/failed"])).rejects.toThrow("cleanup failed");
  });
});

function asyncBody(chunks: Buffer[]) {
  return { async *[Symbol.asyncIterator]() { yield* chunks; } };
}
