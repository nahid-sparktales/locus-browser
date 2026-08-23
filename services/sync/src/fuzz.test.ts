import { describe, expect, it } from "vitest";
import { createSyncApp, hashToken } from "./app.js";
import { MemorySyncRepository } from "./memoryRepository.js";

const token = "fuzz-device-token-that-is-long-enough";

describe("sync protocol fuzz and failure simulation", () => {
  it("rejects deterministic malformed envelopes without a server error", async () => {
    const repository = new MemorySyncRepository();
    repository.enrollToken(hashToken(token), { accountId: "account-fuzz", deviceId: "device-fuzz" });
    const app = createSyncApp(repository);
    const random = lcg(0x5eed1234);
    for (let index = 0; index < 250; index += 1) {
      const payload: Record<string, unknown> = {
        keyVersion: random() > 0.15 ? 1 : [1],
        records: [{
          version: random() > 0.15 ? 1 : 2,
          accountId: random() > 0.2 ? "account-fuzz" : randomValue(random),
          deviceId: random() > 0.2 ? "device-fuzz" : randomValue(random),
          collection: random() > 0.2 ? "bookmarks" : randomValue(random),
          recordId: random() > 0.15 ? `record-${index}` : randomValue(random),
          clock: random() > 0.2 ? `1787408000000-${String(index).padStart(6, "0")}-device-fuzz` : randomValue(random),
          nonce: random() > 0.2 ? "abcdefghijklmnopqrstuvwxyz012345" : randomValue(random),
          ciphertext: random() > 0.2 ? Buffer.from(`value-${index}`).toString("base64url") : randomValue(random),
          tombstone: random() > 0.15 ? false : randomValue(random),
        }],
      };
      const response = await app.inject({
        method: "POST",
        url: "/v1/sync/push",
        headers: { authorization: `Bearer ${token}` },
        payload,
      });
      expect(response.statusCode).toBeLessThan(500);
      expect([200, 400]).toContain(response.statusCode);
    }
    await app.close();
  });

  it("converges a production-sized offline replay to the highest clock", async () => {
    const repository = new MemorySyncRepository();
    repository.enrollToken(hashToken(token), { accountId: "account-fuzz", deviceId: "device-fuzz" });
    const records = Array.from({ length: 500 }, (_, index) => ({
      version: 1 as const,
      accountId: "account-fuzz",
      deviceId: "device-fuzz",
      collection: "history" as const,
      recordId: `offline-${index}`,
      clock: `1787408000000-${String(index).padStart(6, "0")}-device-fuzz`,
      nonce: "abcdefghijklmnopqrstuvwxyz012345",
      ciphertext: Buffer.from(`opaque-${index}`).toString("base64url"),
      tombstone: false,
      size: Buffer.byteLength(`opaque-${index}`),
    }));
    expect((await repository.push({ accountId: "account-fuzz", deviceId: "device-fuzz" }, 1, [...records].reverse())).accepted).toBe(500);
    expect((await repository.push({ accountId: "account-fuzz", deviceId: "device-fuzz" }, 1, records)).accepted).toBe(0);
    const pulled = await repository.pull("account-fuzz", 0, 500);
    expect(pulled.records).toHaveLength(500);
    expect(new Set(pulled.records.map((record) => record.recordId)).size).toBe(500);
  });
});

function lcg(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1_664_525) + 1_013_904_223) >>> 0;
    return value / 0x1_0000_0000;
  };
}

function randomValue(random: () => number): unknown {
  return [null, true, 42, [], {}, "", "../escape", "x".repeat(600)][Math.floor(random() * 8)];
}
