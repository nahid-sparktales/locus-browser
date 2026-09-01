import sodium from "libsodium-wrappers-sumo";
import { z } from "zod";
import { decode, encode, ready } from "./encoding.js";

const SYNC_VERSION = 1;

export const EncryptedRecordSchema = z.object({
  version: z.literal(SYNC_VERSION),
  accountId: z.string().min(1),
  deviceId: z.string().min(1),
  collection: z.enum(["bookmarks", "history", "tab-groups", "remote-tabs", "settings", "extensions"]),
  recordId: z.string().min(1),
  clock: z.string().regex(/^\d{13}-\d{6}-[A-Za-z0-9_-]+$/),
  nonce: z.string().min(1),
  ciphertext: z.string().min(1),
  tombstone: z.boolean().default(false),
});

export type EncryptedRecord = z.infer<typeof EncryptedRecordSchema>;
export type SyncCollection = EncryptedRecord["collection"];

export interface RecordMetadata {
  accountId: string;
  deviceId: string;
  collection: SyncCollection;
  recordId: string;
  clock: string;
  tombstone?: boolean;
}

export async function encryptRecord(
  accountKey: string,
  metadata: RecordMetadata,
  value: unknown,
): Promise<EncryptedRecord> {
  await ready();
  const key = deriveRecordKey(accountKey, metadata.collection, metadata.recordId);
  const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  const aad = associatedData(metadata);
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(plaintext, aad, null, nonce, key);
  key.fill(0);
  return EncryptedRecordSchema.parse({
    version: SYNC_VERSION,
    ...metadata,
    tombstone: Boolean(metadata.tombstone),
    nonce: encode(nonce),
    ciphertext: encode(ciphertext),
  });
}

export async function decryptRecord(accountKey: string, record: EncryptedRecord): Promise<unknown> {
  await ready();
  const parsed = EncryptedRecordSchema.parse(record);
  const key = deriveRecordKey(accountKey, parsed.collection, parsed.recordId);
  const plaintext = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
    null,
    decode(parsed.ciphertext),
    associatedData(parsed),
    decode(parsed.nonce),
    key,
  );
  key.fill(0);
  return JSON.parse(new TextDecoder().decode(plaintext));
}

function deriveRecordKey(accountKey: string, collection: string, recordId: string): Uint8Array {
  return sodium.crypto_generichash(32, `${collection}:${recordId}`, decode(accountKey));
}

function associatedData(metadata: RecordMetadata): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({
    version: SYNC_VERSION,
    accountId: metadata.accountId,
    deviceId: metadata.deviceId,
    collection: metadata.collection,
    recordId: metadata.recordId,
    clock: metadata.clock,
    tombstone: Boolean(metadata.tombstone),
  }));
}
