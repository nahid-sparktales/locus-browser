import { createHash, randomBytes } from "node:crypto";
import sodium from "libsodium-wrappers-sumo";
import { z } from "zod";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
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

export interface DeviceKeyPair {
  publicKey: string;
  privateKey: string;
}

export interface RecordMetadata {
  accountId: string;
  deviceId: string;
  collection: SyncCollection;
  recordId: string;
  clock: string;
  tombstone?: boolean;
}

export async function ready(): Promise<void> {
  await sodium.ready;
}

export async function generateAccountKey(): Promise<string> {
  await ready();
  return encode(sodium.randombytes_buf(32));
}

export async function generateDeviceKeyPair(): Promise<DeviceKeyPair> {
  await ready();
  const pair = sodium.crypto_box_keypair();
  return { publicKey: encode(pair.publicKey), privateKey: encode(pair.privateKey) };
}

export async function wrapAccountKey(accountKey: string, devicePublicKey: string): Promise<string> {
  await ready();
  return encode(sodium.crypto_box_seal(decode(accountKey), decode(devicePublicKey)));
}

export async function unwrapAccountKey(wrapped: string, device: DeviceKeyPair): Promise<string> {
  await ready();
  const opened = sodium.crypto_box_seal_open(decode(wrapped), decode(device.publicKey), decode(device.privateKey));
  if (!opened) throw new Error("Could not unwrap the account sync key");
  return encode(opened);
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

export function createRecoveryKey(accountKey: string): string {
  const raw = Buffer.from(decode(accountKey));
  if (raw.byteLength !== 32) throw new Error("Account key must contain 32 bytes");
  const checksum = createHash("sha256").update(raw).digest().subarray(0, 4);
  const encoded = encodeBase32(Buffer.concat([raw, checksum]));
  return `LOCUS-${encoded.match(/.{1,5}/g)!.join("-")}`;
}

export function recoverAccountKey(recoveryKey: string): string {
  const normalized = recoveryKey.toUpperCase().replace(/^LOCUS-/, "").replace(/-/g, "");
  const decoded = decodeBase32(normalized);
  if (decoded.byteLength !== 36) throw new Error("Recovery key has the wrong length");
  const raw = decoded.subarray(0, 32);
  const supplied = decoded.subarray(32);
  const expected = createHash("sha256").update(raw).digest().subarray(0, 4);
  if (!expected.equals(supplied)) throw new Error("Recovery key checksum is invalid");
  return encode(raw);
}

export class HybridLogicalClock {
  #physical = 0;
  #logical = 0;

  constructor(readonly deviceId: string) {}

  tick(now = Date.now()): string {
    if (now > this.#physical) {
      this.#physical = now;
      this.#logical = 0;
    } else {
      this.#logical += 1;
    }
    return formatClock(this.#physical, this.#logical, this.deviceId);
  }

  observe(remote: string, now = Date.now()): string {
    const parsed = parseClock(remote);
    const maximum = Math.max(now, this.#physical, parsed.physical);
    if (maximum === this.#physical && maximum === parsed.physical) this.#logical = Math.max(this.#logical, parsed.logical) + 1;
    else if (maximum === this.#physical) this.#logical += 1;
    else if (maximum === parsed.physical) this.#logical = parsed.logical + 1;
    else this.#logical = 0;
    this.#physical = maximum;
    return formatClock(this.#physical, this.#logical, this.deviceId);
  }
}

export function compareClocks(left: string, right: string): number {
  return left.localeCompare(right);
}

export function mergePerField<T extends Record<string, { value: unknown; clock: string }>>(left: T, right: T): T {
  const result = { ...left };
  for (const [field, candidate] of Object.entries(right)) {
    const existing = result[field];
    if (!existing || compareClocks(candidate.clock, existing.clock) > 0) result[field as keyof T] = candidate as T[keyof T];
  }
  return result;
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

function encode(value: Uint8Array): string {
  return sodium.to_base64(value, sodium.base64_variants.URLSAFE_NO_PADDING);
}

function decode(value: string): Uint8Array {
  return sodium.from_base64(value, sodium.base64_variants.URLSAFE_NO_PADDING);
}

function formatClock(physical: number, logical: number, deviceId: string): string {
  return `${Math.max(physical, 0).toString().padStart(13, "0")}-${Math.max(logical, 0).toString().padStart(6, "0")}-${deviceId}`;
}

function parseClock(value: string): { physical: number; logical: number } {
  const match = /^(\d{13})-(\d{6})-[A-Za-z0-9_-]+$/.exec(value);
  if (!match) throw new Error("Malformed hybrid logical clock");
  return { physical: Number(match[1]), logical: Number(match[2]) };
}

function encodeBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}

function decodeBase32(value: string): Buffer {
  let bits = 0;
  let accumulator = 0;
  const output: number[] = [];
  for (const character of value) {
    const index = BASE32.indexOf(character);
    if (index < 0) throw new Error("Recovery key contains an invalid character");
    accumulator = (accumulator << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((accumulator >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

export function randomDeviceId(): string {
  return randomBytes(12).toString("base64url");
}
