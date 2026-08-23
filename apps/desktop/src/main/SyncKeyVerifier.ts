import { EncryptedRecordSchema, decryptRecord, encryptRecord, type EncryptedRecord } from "@locus/sync-crypto";
import { z } from "zod";

export const SYNC_KEY_VERIFIER_RECORD_ID = "locus-account-key-verifier-v1";

const SyncKeyVerifierValueSchema = z.object({
  purpose: z.literal("locus-account-key"),
  version: z.literal(1),
});

export async function createSyncKeyVerifier(
  accountKey: string,
  accountId: string,
  deviceId: string,
  clock: string,
): Promise<EncryptedRecord> {
  return await encryptRecord(accountKey, {
    accountId,
    deviceId,
    collection: "settings",
    recordId: SYNC_KEY_VERIFIER_RECORD_ID,
    clock,
  }, { purpose: "locus-account-key", version: 1 });
}

export async function assertSyncKeyVerifier(accountKey: string, input: unknown): Promise<void> {
  const record = EncryptedRecordSchema.parse(input);
  if (record.collection !== "settings" || record.recordId !== SYNC_KEY_VERIFIER_RECORD_ID || record.tombstone) {
    throw new Error("Sync account key verifier is invalid");
  }
  try {
    SyncKeyVerifierValueSchema.parse(await decryptRecord(accountKey, record));
  } catch {
    throw new Error("The recovery key does not match this sync account");
  }
}
