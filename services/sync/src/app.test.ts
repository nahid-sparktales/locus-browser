import { describe, expect, it } from "vitest";
import { createSyncApp, hashToken } from "./app.js";
import { MemorySyncRepository } from "./memoryRepository.js";

const token = "test-device-token-that-is-long-enough";

function fixture() {
  const repository = new MemorySyncRepository();
  repository.enrollToken(hashToken(token), { accountId: "account-a", deviceId: "device-a" });
  return createSyncApp(repository);
}

describe("opaque sync service", () => {
  it("requires a valid device token", async () => {
    const response = await fixture().inject({ method: "GET", url: "/v1/sync/pull" });
    expect(response.statusCode).toBe(401);
  });

  it("stores ciphertext and returns it through a cursor", async () => {
    const app = fixture();
    const authorization = { authorization: `Bearer ${token}` };
    const push = await app.inject({
      method: "POST", url: "/v1/sync/push", headers: authorization,
      payload: { records: [{
        accountId: "account-a", deviceId: "device-a", collection: "bookmarks", recordId: "record-a",
        clock: "1700000000000-000000-device-a", nonce: "abcdefghijklmnopqrstuvwxyz012345", ciphertext: "aGVsbG8td29ybGQ", tombstone: false,
      }] },
    });
    expect(push.statusCode).toBe(200);
    const pull = await app.inject({ method: "GET", url: "/v1/sync/pull?cursor=0", headers: authorization });
    expect(pull.json().records[0].ciphertext).toBe("aGVsbG8td29ybGQ");
    expect(pull.json().records[0]).not.toHaveProperty("title");
  });

  it("rejects records from another device", async () => {
    const response = await fixture().inject({
      method: "POST", url: "/v1/sync/push", headers: { authorization: `Bearer ${token}` },
      payload: { records: [{
        accountId: "account-a", deviceId: "device-b", collection: "history", recordId: "record-a",
        clock: "1700000000000-000000-device-b", nonce: "abcdefghijklmnopqrstuvwxyz012345", ciphertext: "aGVsbG8td29ybGQ", tombstone: false,
      }] },
    });
    expect(response.statusCode).toBe(400);
  });
});
