import { describe, expect, it } from "vitest";
import {
  EncryptedRecordSchema,
  HybridLogicalClock,
  createRecoveryKey,
  decryptRecord,
  encryptRecord,
  generateAccountKey,
  generateDeviceKeyPair,
  recoverAccountKey,
  unwrapAccountKey,
  wrapAccountKey,
} from "@locus/sync-crypto";
import { createSyncApp, hashToken } from "./app.js";
import { MemorySyncRepository } from "./memoryRepository.js";
import { passkeyClientScript, type PasskeyToolkit } from "./passkeyAuth.js";

const token = "test-device-token-that-is-long-enough";

const passkeyToolkit: PasskeyToolkit = {
  registrationOptions: async () => ({ challenge: "registration-challenge", rp: { id: "localhost", name: "Locus Sync" }, user: { id: "dXNlcg", name: "locus", displayName: "Locus" } }),
  authenticationOptions: async () => ({ challenge: "authentication-challenge", rpId: "localhost", allowCredentials: [] }),
  verifyRegistration: async ({ challenge }) => ({
    verified: challenge === "registration-challenge",
    credential: {
      id: "credential-a",
      publicKey: "cHVibGljLWtleQ",
      counter: 0,
      transports: ["internal"],
      deviceType: "multiDevice",
      backedUp: true,
    },
  }),
  verifyAuthentication: async ({ challenge }) => ({ verified: challenge === "authentication-challenge", newCounter: 7 }),
};

function fixture(options: { passkeys?: boolean } = {}) {
  const repository = new MemorySyncRepository();
  repository.enrollToken(hashToken(token), { accountId: "account-a", deviceId: "device-a" });
  return createSyncApp(repository, options.passkeys ? { passkeyToolkit } : {});
}

const credential = {
  id: "credential-a",
  rawId: "Y3JlZGVudGlhbC1h",
  type: "public-key",
  response: { clientDataJSON: "Y2xpZW50", attestationObject: "YXR0ZXN0YXRpb24" },
  clientExtensionResults: {},
};

describe("opaque sync service", () => {
  it("emits a syntactically valid isolated passkey client", () => {
    expect(() => new Function(passkeyClientScript())).not.toThrow();
  });

  it("requires a valid device token", async () => {
    const response = await fixture().inject({ method: "GET", url: "/v1/sync/pull" });
    expect(response.statusCode).toBe(401);
  });

  it("stores ciphertext and returns it through a cursor", async () => {
    const app = fixture();
    const authorization = { authorization: `Bearer ${token}` };
    const push = await app.inject({
      method: "POST", url: "/v1/sync/push", headers: authorization,
      payload: { keyVersion: 1, records: [{
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
      payload: { keyVersion: 1, records: [{
        accountId: "account-a", deviceId: "device-b", collection: "history", recordId: "record-a",
        clock: "1700000000000-000000-device-b", nonce: "abcdefghijklmnopqrstuvwxyz012345", ciphertext: "aGVsbG8td29ybGQ", tombstone: false,
      }] },
    });
    expect(response.statusCode).toBe(400);
  });

  it("registers a passkey, delivers the device token through a one-time claim, and rejects replay", async () => {
    const app = fixture({ passkeys: true });
    const started = await app.inject({
      method: "POST",
      url: "/v1/auth/passkeys/register/options",
      payload: { displayName: "Personal", deviceId: "new-device", deviceName: "New Mac", devicePublicKey: "device-public-key-that-is-long-enough" },
    });
    expect(started.statusCode).toBe(200);
    const { ceremonyId, authUrl } = started.json();
    expect(authUrl).toBe(`http://localhost:8787/v1/auth/passkeys/ceremonies/${ceremonyId}`);

    const page = await app.inject({ method: "GET", url: `/v1/auth/passkeys/ceremonies/${ceremonyId}` });
    expect(page.statusCode).toBe(200);
    expect(page.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(page.body).not.toContain("device-public-key-that-is-long-enough");

    const verified = await app.inject({
      method: "POST",
      url: `/v1/auth/passkeys/ceremonies/${ceremonyId}/verify`,
      payload: { credential },
    });
    expect(verified.statusCode).toBe(200);
    const callback = new URL(verified.json().callbackUrl);
    const claimId = callback.searchParams.get("claimId")!;
    const claimCode = callback.searchParams.get("claimCode")!;
    const claimed = await app.inject({
      method: "POST", url: "/v1/auth/passkeys/claims", payload: { claimId, claimCode },
    });
    expect(claimed.statusCode).toBe(200);
    expect(claimed.json()).toMatchObject({ deviceId: "new-device" });
    expect(claimed.json().deviceToken).toHaveLength(43);

    const replayedClaim = await app.inject({
      method: "POST", url: "/v1/auth/passkeys/claims", payload: { claimId, claimCode },
    });
    expect(replayedClaim.statusCode).toBe(404);
    const replayedCeremony = await app.inject({
      method: "POST", url: `/v1/auth/passkeys/ceremonies/${ceremonyId}/verify`, payload: { credential },
    });
    expect(replayedCeremony.statusCode).toBe(404);

    const authenticated = await app.inject({
      method: "GET",
      url: "/v1/sync/pull",
      headers: { authorization: `Bearer ${claimed.json().deviceToken}` },
    });
    expect(authenticated.statusCode).toBe(200);
  });

  it("authenticates a discoverable passkey on a new device", async () => {
    const app = fixture({ passkeys: true });
    const registration = await app.inject({
      method: "POST", url: "/v1/auth/passkeys/register/options",
      payload: { displayName: "Personal", deviceId: "first-device", deviceName: "First Mac", devicePublicKey: "first-device-public-key-is-long-enough" },
    });
    await app.inject({
      method: "POST",
      url: `/v1/auth/passkeys/ceremonies/${registration.json().ceremonyId}/verify`,
      payload: { credential },
    });

    const authentication = await app.inject({
      method: "POST", url: "/v1/auth/passkeys/authenticate/options",
      payload: { deviceId: "second-device", deviceName: "Second Mac", devicePublicKey: "second-device-public-key-is-long-enough" },
    });
    const verified = await app.inject({
      method: "POST",
      url: `/v1/auth/passkeys/ceremonies/${authentication.json().ceremonyId}/verify`,
      payload: { credential: { ...credential, response: { clientDataJSON: "Y2xpZW50", authenticatorData: "YXV0aC1kYXRh", signature: "c2lnbmF0dXJl" } } },
    });
    expect(verified.statusCode).toBe(200);
    expect(verified.json().callbackUrl).toMatch(/^locus-browser:\/\/sync-auth\/callback\?/);
  });

  it("moves only ciphertext between two devices, converges conflicts, rejects tampering, and enforces revocation", async () => {
    const app = fixture({ passkeys: true });
    const claimDevice = async (kind: "register" | "authenticate", deviceId: string) => {
      const start = await app.inject({
        method: "POST",
        url: kind === "register" ? "/v1/auth/passkeys/register/options" : "/v1/auth/passkeys/authenticate/options",
        payload: { ...(kind === "register" ? { displayName: "Personal" } : {}), deviceId, deviceName: deviceId, devicePublicKey: `${deviceId}-public-key-that-is-long-enough` },
      });
      const verified = await app.inject({
        method: "POST",
        url: `/v1/auth/passkeys/ceremonies/${start.json().ceremonyId}/verify`,
        payload: { credential: kind === "register" ? credential : { ...credential, response: { clientDataJSON: "Y2xpZW50", authenticatorData: "YXV0aC1kYXRh", signature: "c2lnbmF0dXJl" } } },
      });
      const callback = new URL(verified.json().callbackUrl);
      const claimed = await app.inject({
        method: "POST", url: "/v1/auth/passkeys/claims",
        payload: { claimId: callback.searchParams.get("claimId"), claimCode: callback.searchParams.get("claimCode") },
      });
      expect(claimed.statusCode).toBe(200);
      return claimed.json() as { accountId: string; deviceId: string; deviceToken: string };
    };

    const deviceA = await claimDevice("register", "device-a-secure");
    const accountKey = await generateAccountKey();
    const recoveredKey = recoverAccountKey(createRecoveryKey(accountKey));
    const initialized = await app.inject({
      method: "PUT", url: "/v1/account/key", headers: { authorization: `Bearer ${deviceA.deviceToken}` },
      payload: { expectedVersion: 0, version: 1, wraps: [{ deviceId: deviceA.deviceId, wrappedAccountKey: "wrapped-account-key-for-device-a-secure" }] },
    });
    expect(initialized.statusCode).toBe(200);
    const deviceBKeys = await generateDeviceKeyPair();
    const enrollment = await app.inject({
      method: "POST", url: "/v1/devices/enrollments",
      payload: { deviceId: "device-b-secure", deviceName: "Second Mac", publicKey: deviceBKeys.publicKey },
    });
    expect(enrollment.statusCode).toBe(200);
    const enrollmentDetails = await app.inject({
      method: "POST", url: `/v1/devices/enrollments/${enrollment.json().enrollmentId}/details`,
      headers: { authorization: `Bearer ${deviceA.deviceToken}` },
      payload: { approvalCode: enrollment.json().approvalCode },
    });
    expect(enrollmentDetails.json()).toMatchObject({ deviceId: "device-b-secure", deviceName: "Second Mac", publicKey: deviceBKeys.publicKey });
    const wrappedForB = await wrapAccountKey(accountKey, deviceBKeys.publicKey);
    expect((await app.inject({
      method: "POST", url: `/v1/devices/enrollments/${enrollment.json().enrollmentId}/approve`,
      headers: { authorization: `Bearer ${deviceA.deviceToken}` },
      payload: { approvalCode: enrollment.json().approvalCode, wrappedAccountKey: wrappedForB },
    })).statusCode).toBe(200);
    const claimedB = await app.inject({
      method: "POST", url: "/v1/devices/enrollments/claim",
      payload: { enrollmentId: enrollment.json().enrollmentId, approvalCode: enrollment.json().approvalCode },
    });
    const deviceB = claimedB.json() as { accountId: string; deviceId: string; deviceToken: string; wrappedAccountKey: string; keyVersion: number };
    expect(deviceB).toMatchObject({ accountId: deviceA.accountId, deviceId: "device-b-secure", keyVersion: 1 });
    expect(await unwrapAccountKey(deviceB.wrappedAccountKey, deviceBKeys)).toBe(accountKey);
    const devices = await app.inject({ method: "GET", url: "/v1/devices", headers: { authorization: `Bearer ${deviceA.deviceToken}` } });
    expect(devices.json().devices).toHaveLength(2);
    const clockA = new HybridLogicalClock(deviceA.deviceId);
    const original = await encryptRecord(accountKey, {
      accountId: deviceA.accountId, deviceId: deviceA.deviceId, collection: "bookmarks", recordId: "shared-bookmark", clock: clockA.tick(1_787_408_000_000),
    }, { title: "Original", url: "https://example.com" });
    const pushedA = await app.inject({
      method: "POST", url: "/v1/sync/push", headers: { authorization: `Bearer ${deviceA.deviceToken}` }, payload: { keyVersion: 1, records: [original] },
    });
    expect(pushedA.statusCode).toBe(200);
    expect(pushedA.json().accepted).toBe(1);
    const replayedA = await app.inject({
      method: "POST", url: "/v1/sync/push", headers: { authorization: `Bearer ${deviceA.deviceToken}` }, payload: { keyVersion: 1, records: [original] },
    });
    expect(replayedA.json()).toMatchObject({ accepted: 0, cursor: pushedA.json().cursor });

    const pulledB = await app.inject({
      method: "GET", url: "/v1/sync/pull?cursor=0", headers: { authorization: `Bearer ${deviceB.deviceToken}` },
    });
    const fromA = EncryptedRecordSchema.parse(pulledB.json().records[0]);
    expect(await decryptRecord(recoveredKey, fromA)).toEqual({ title: "Original", url: "https://example.com" });
    expect(JSON.stringify(pulledB.json())).not.toContain("Original");

    const clockB = new HybridLogicalClock(deviceB.deviceId);
    clockB.observe(fromA.clock, 1_787_408_000_000);
    const edited = await encryptRecord(recoveredKey, {
      accountId: deviceB.accountId, deviceId: deviceB.deviceId, collection: "bookmarks", recordId: "shared-bookmark", clock: clockB.tick(1_787_408_000_001),
    }, { title: "Edited on B", url: "https://example.com" });
    expect((await app.inject({
      method: "POST", url: "/v1/sync/push", headers: { authorization: `Bearer ${deviceB.deviceToken}` }, payload: { keyVersion: 1, records: [edited] },
    })).statusCode).toBe(200);
    const converged = await app.inject({
      method: "GET", url: `/v1/sync/pull?cursor=${pulledB.json().cursor}`, headers: { authorization: `Bearer ${deviceA.deviceToken}` },
    });
    const fromB = EncryptedRecordSchema.parse(converged.json().records[0]);
    expect(await decryptRecord(accountKey, fromB)).toEqual({ title: "Edited on B", url: "https://example.com" });

    const rotatedKey = await generateAccountKey();
    const rotationClock = new HybridLogicalClock(deviceA.deviceId);
    rotationClock.observe(fromB.clock, 1_787_408_000_001);
    const rotated = await encryptRecord(rotatedKey, {
      accountId: deviceA.accountId,
      deviceId: deviceA.deviceId,
      collection: fromB.collection,
      recordId: fromB.recordId,
      clock: rotationClock.tick(1_787_408_000_002),
    }, await decryptRecord(accountKey, fromB));
    const rotation = await app.inject({
      method: "POST", url: "/v1/account/key/rotate", headers: { authorization: `Bearer ${deviceA.deviceToken}` },
      payload: {
        expectedVersion: 1,
        version: 2,
        wraps: [
          { deviceId: deviceA.deviceId, wrappedAccountKey: "version-two-wrapped-key-for-device-a" },
          { deviceId: deviceB.deviceId, wrappedAccountKey: "version-two-wrapped-key-for-device-b" },
        ],
        records: [rotated],
      },
    });
    expect(rotation.statusCode).toBe(200);
    const keyForB = await app.inject({ method: "GET", url: "/v1/account/key", headers: { authorization: `Bearer ${deviceB.deviceToken}` } });
    expect(keyForB.json()).toEqual({ version: 2, wrappedAccountKey: "version-two-wrapped-key-for-device-b" });
    expect((await app.inject({
      method: "POST", url: "/v1/sync/push", headers: { authorization: `Bearer ${deviceB.deviceToken}` },
      payload: { keyVersion: 1, records: [edited] },
    })).statusCode).toBe(400);
    const afterRotation = await app.inject({
      method: "GET", url: "/v1/sync/pull?cursor=0", headers: { authorization: `Bearer ${deviceA.deviceToken}` },
    });
    expect(await decryptRecord(rotatedKey, EncryptedRecordSchema.parse(afterRotation.json().records[0]))).toEqual({ title: "Edited on B", url: "https://example.com" });

    const corruptedCiphertext = `${fromB.ciphertext[0] === "A" ? "B" : "A"}${fromB.ciphertext.slice(1)}`;
    await expect(decryptRecord(accountKey, { ...fromB, ciphertext: corruptedCiphertext })).rejects.toThrow();
    expect((await app.inject({
      method: "DELETE", url: `/v1/devices/${deviceB.deviceId}`, headers: { authorization: `Bearer ${deviceA.deviceToken}` },
    })).statusCode).toBe(200);
    expect((await app.inject({
      method: "GET", url: "/v1/sync/pull", headers: { authorization: `Bearer ${deviceB.deviceToken}` },
    })).statusCode).toBe(401);
  });
});
