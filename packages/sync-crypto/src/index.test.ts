import { describe, expect, it } from "vitest";
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
});
