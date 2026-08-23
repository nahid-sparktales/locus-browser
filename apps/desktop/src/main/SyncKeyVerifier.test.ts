import { generateAccountKey } from "@locus/sync-crypto";
import { describe, expect, it } from "vitest";
import { assertSyncKeyVerifier, createSyncKeyVerifier } from "./SyncKeyVerifier.js";

describe("sync account-key verifier", () => {
  it("accepts only the account key that created the encrypted verifier", async () => {
    const accountKey = await generateAccountKey();
    const record = await createSyncKeyVerifier(accountKey, "account-a", "device-a", "1787408000000-000000-device-a");
    await expect(assertSyncKeyVerifier(accountKey, record)).resolves.toBeUndefined();
    await expect(assertSyncKeyVerifier(await generateAccountKey(), record)).rejects.toThrow("does not match");
  });

  it("rejects tombstoned and tampered verifier records", async () => {
    const accountKey = await generateAccountKey();
    const record = await createSyncKeyVerifier(accountKey, "account-a", "device-a", "1787408000000-000000-device-a");
    await expect(assertSyncKeyVerifier(accountKey, { ...record, tombstone: true })).rejects.toThrow("invalid");
    const ciphertext = `${record.ciphertext[0] === "A" ? "B" : "A"}${record.ciphertext.slice(1)}`;
    await expect(assertSyncKeyVerifier(accountKey, { ...record, ciphertext })).rejects.toThrow("does not match");
  });
});
