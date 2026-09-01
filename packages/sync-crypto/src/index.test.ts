import { describe, expect, it } from "vitest";
import * as syncCryptoApi from "./index.js";
import {
  HybridLogicalClock,
  createRecoveryKey,
  decryptRecord,
  encryptRecord,
  generateAccountKey,
  generateDeviceKeyPair,
  recoverAccountKey,
  unwrapAccountKey,
  wrapAccountKey,
} from "./index.js";

describe("encrypted sync", () => {
  it("preserves the public runtime export contract", () => {
    expect(Object.keys(syncCryptoApi).sort()).toEqual([
      "EncryptedRecordSchema", "HybridLogicalClock", "compareClocks", "createRecoveryKey",
      "decryptLocalValue", "decryptRecord", "encryptLocalValue", "encryptRecord",
      "generateAccountKey", "generateDeviceKeyPair", "generateLocalEncryptionKey",
      "mergePerField", "randomDeviceId", "ready", "recoverAccountKey",
      "unwrapAccountKey", "wrapAccountKey",
    ].sort());
  });

  it("encrypts record contents and authenticates their metadata", async () => {
    const key = await generateAccountKey();
    const clock = new HybridLogicalClock("device-a").tick(1_700_000_000_000);
    const record = await encryptRecord(key, {
      accountId: "account-a", deviceId: "device-a", collection: "bookmarks", recordId: "bookmark-a", clock,
    }, { title: "Private", url: "https://example.com" });
    expect(record.ciphertext).not.toContain("Private");
    await expect(decryptRecord(key, record)).resolves.toEqual({ title: "Private", url: "https://example.com" });
    await expect(decryptRecord(key, { ...record, recordId: "changed" })).rejects.toThrow();
  });

  it("wraps the account key to a newly approved device", async () => {
    const accountKey = await generateAccountKey();
    const device = await generateDeviceKeyPair();
    const wrapped = await wrapAccountKey(accountKey, device.publicKey);
    await expect(unwrapAccountKey(wrapped, device)).resolves.toBe(accountKey);
  });

  it("round-trips a checksummed one-time recovery key", async () => {
    const accountKey = await generateAccountKey();
    const recovery = createRecoveryKey(accountKey);
    expect(recovery.startsWith("LOCUS-")).toBe(true);
    expect(recoverAccountKey(recovery)).toBe(accountKey);
    const corrupted = recovery.split("");
    corrupted[6] = corrupted[6] === "A" ? "B" : "A";
    expect(() => recoverAccountKey(corrupted.join(""))).toThrow();
  });

  it("orders concurrent clock events by device id", () => {
    const left = new HybridLogicalClock("device-a").tick(1_700_000_000_000);
    const right = new HybridLogicalClock("device-b").tick(1_700_000_000_000);
    expect(left < right).toBe(true);
  });

  it("round-trips varied payloads and rejects ciphertext or associated-data fuzz mutations", async () => {
    const key = await generateAccountKey();
    for (let index = 0; index < 100; index += 1) {
      const metadata = {
        accountId: "account-fuzz",
        deviceId: `device-${index % 7}`,
        collection: (["bookmarks", "history", "settings", "extensions"] as const)[index % 4]!,
        recordId: `record-${index}`,
        clock: new HybridLogicalClock(`device-${index % 7}`).tick(1_787_408_000_000 + index),
      };
      const payload = {
        index,
        text: `${"🙂".repeat(index % 11)}\0${"x".repeat(index * 3)}`,
        nested: { enabled: index % 2 === 0, values: [index, null, `value-${index}`] },
      };
      const record = await encryptRecord(key, metadata, payload);
      await expect(decryptRecord(key, record)).resolves.toEqual(payload);
      const first = record.ciphertext[0]!;
      await expect(decryptRecord(key, {
        ...record,
        ciphertext: `${first === "A" ? "B" : "A"}${record.ciphertext.slice(1)}`,
      })).rejects.toThrow();
      await expect(decryptRecord(key, { ...record, clock: `${record.clock}-tampered` })).rejects.toThrow();
    }
  });
});
