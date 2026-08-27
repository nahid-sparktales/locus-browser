import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BrowserDatabase } from "./BrowserDatabase.js";
import { serializePortableMemory } from "./PortableMemory.js";
import type { WalrusManualConfiguration } from "../shared/walrusPrivate.js";
import {
  WALRUS_PRODUCTION_RELAYER,
  WalrusMemoryClient,
  normalizeWalrusConfig,
  safeWalrusError,
} from "./WalrusMemoryClient.js";

const cipher = {
  available: () => true,
  encrypt: (value: string) => Buffer.from(`sealed:${value}`),
  decrypt: (value: Uint8Array) => Buffer.from(value).toString().replace(/^sealed:/, ""),
};

function fakeMemWal() {
  const memory = serializePortableMemory({
    type: "page", title: "Portable finding", sourceUrl: "https://example.com/report",
    capturedAt: "2026-08-26T12:00:00.000Z", contentSha256: "c".repeat(64), body: "Evidence for Work.",
  });
  return {
    compatibility: async () => ({ apiVersion: "1" }),
    recall: async (options: { query: string }) => ({
      results: options.query === "Locus connection verification"
        ? []
        : [{ blob_id: "blob-1", text: memory, distance: 0.1 }],
    }),
    rememberAsync: async () => ({ job_id: "job-1", status: "pending" }),
    getRememberStatus: async () => ({ job_id: "job-1", status: "done" as const, blob_id: "blob-1" }),
    waitForRememberJob: async () => ({ id: "job-1", job_id: "job-1", blob_id: "blob-1", namespace: "locus-browser-v1" }),
    restore: async () => ({ restored: 1, skipped: 2, total: 3, truncated: false }),
    destroy: () => undefined,
  };
}

describe("WalrusMemoryClient", () => {
  it("encrypts a profile-scoped delegate, verifies recall, stores content-free receipts, and disconnects locally", async () => {
    const database = new BrowserDatabase(join(mkdtempSync(join(tmpdir(), "locus-walrus-")), "browser.sqlite3"));
    const client = new WalrusMemoryClient(database, cipher, "default", {
      packaged: true,
      createClient: () => fakeMemWal(),
    });
    await client.connect("0xabc", "locus-browser-v1", "delegate-secret", "https://untrusted.example.com");
    expect(client.state()).toMatchObject({
      status: "connected", usable: true, accountId: "0xabc", namespace: "locus-browser-v1", relayerUrl: WALRUS_PRODUCTION_RELAYER,
    });
    expect(JSON.stringify(database.setting("default", "walrusMemoryCredentialV1"))).not.toContain("delegate-secret");
    const results = await client.recall("finding");
    expect(results[0]).toMatchObject({ blobId: "blob-1", title: "Portable finding", sourceUrl: "https://example.com/report" });
    await client.remember("previewed content");
    expect(database.listWalrusMemoryReceipts("default")).toEqual([
      expect.objectContaining({ jobId: "job-1", blobId: "blob-1", namespace: "locus-browser-v1", status: "done" }),
    ]);
    expect(JSON.stringify(database.listWalrusMemoryReceipts("default"))).not.toContain("previewed content");
    database.queueSyncSnapshot("default", "device-1", () => "0001:device-1");
    expect(database.syncOutbox("default").map((record) => record.recordId)).not.toContain("walrusMemoryCredentialV1");
    client.disconnect();
    expect(client.state()).toMatchObject({ status: "disconnected", usable: false });
    expect(database.setting("default", "walrusMemoryCredentialV1")).toBeUndefined();
    expect(database.listWalrusMemoryReceipts("default")).toHaveLength(1);
    database.close();
  });

  it("does not persist a delegate when compatibility or authentication checks fail", async () => {
    const database = new BrowserDatabase(join(mkdtempSync(join(tmpdir(), "locus-walrus-failed-")), "browser.sqlite3"));
    const client = new WalrusMemoryClient(database, cipher, "default", {
      packaged: true,
      createClient: () => ({ ...fakeMemWal(), compatibility: async () => { throw new Error("401 unauthorized"); } }),
    });
    await expect(client.connect("0xabc", "locus-browser-v1", "delegate-secret")).rejects.toThrow(/delegate/i);
    expect(client.state()).toMatchObject({ status: "error", usable: false });
    expect(database.setting("default", "walrusMemoryCredentialV1")).toBeUndefined();
    database.close();
  });

  it("rejects malformed stored credentials and marks revoked delegates unusable on startup", async () => {
    const database = new BrowserDatabase(join(mkdtempSync(join(tmpdir(), "locus-walrus-startup-")), "browser.sqlite3"));
    database.setSetting("default", "walrusMemoryConfigV1", {
      accountId: "0xabc", namespace: "locus-browser-v1", relayerUrl: WALRUS_PRODUCTION_RELAYER,
    });
    database.setSetting("default", "walrusMemoryCredentialV1", { encryptedDelegateKey: "malformed" });
    const malformed = new WalrusMemoryClient(database, { ...cipher, decrypt: () => { throw new Error("invalid ciphertext"); } }, "default", {
      packaged: true, createClient: () => fakeMemWal(),
    });
    await malformed.initialize();
    expect(malformed.state()).toMatchObject({ status: "disconnected", usable: false });

    database.setSetting("default", "walrusMemoryCredentialV1", {
      encryptedDelegateKey: Buffer.from(cipher.encrypt("revoked-delegate")).toString("base64"),
    });
    const revoked = new WalrusMemoryClient(database, cipher, "default", {
      packaged: true,
      createClient: () => ({ ...fakeMemWal(), compatibility: async () => { throw new Error("401 revoked delegate"); } }),
    });
    await revoked.initialize();
    expect(revoked.state()).toMatchObject({ status: "error", usable: false });
    expect(revoked.state().message).toMatch(/revoked/i);
    database.close();
  });

  it("retains content-free receipts for failed and timed-out remember jobs", async () => {
    const failedDatabase = new BrowserDatabase(join(mkdtempSync(join(tmpdir(), "locus-walrus-job-failed-")), "browser.sqlite3"));
    const failed = new WalrusMemoryClient(failedDatabase, cipher, "default", {
      packaged: true,
      createClient: () => ({
        ...fakeMemWal(),
        waitForRememberJob: async () => { throw new Error("job failed"); },
        getRememberStatus: async () => ({ job_id: "job-1", status: "failed" as const }),
      }),
    });
    await failed.connect("0xabc", "locus-browser-v1", "delegate-secret");
    await expect(failed.remember("exact preview")).rejects.toThrow(/could not complete/i);
    expect(failedDatabase.listWalrusMemoryReceipts("default")[0]).toMatchObject({ jobId: "job-1", status: "failed" });
    expect(JSON.stringify(failedDatabase.listWalrusMemoryReceipts("default"))).not.toContain("exact preview");
    failedDatabase.close();

    const timeoutDatabase = new BrowserDatabase(join(mkdtempSync(join(tmpdir(), "locus-walrus-job-timeout-")), "browser.sqlite3"));
    const timedOut = new WalrusMemoryClient(timeoutDatabase, cipher, "default", {
      packaged: true,
      createClient: () => ({
        ...fakeMemWal(),
        waitForRememberJob: async () => { throw new Error("request timed out"); },
        getRememberStatus: async () => { throw new Error("offline"); },
      }),
    });
    await timedOut.connect("0xabc", "locus-browser-v1", "delegate-secret");
    await expect(timedOut.remember("exact preview")).rejects.toThrow(/receipt/i);
    expect(timeoutDatabase.listWalrusMemoryReceipts("default")[0]).toMatchObject({ jobId: "job-1", status: "timeout" });
    timeoutDatabase.close();
  });

  it("guides recall-index lag and reports bounded restore progress", async () => {
    const database = new BrowserDatabase(join(mkdtempSync(join(tmpdir(), "locus-walrus-restore-")), "browser.sqlite3"));
    const client = new WalrusMemoryClient(database, cipher, "default", {
      packaged: true,
      createClient: () => ({ ...fakeMemWal(), recall: async () => ({ results: [] }) }),
    });
    await client.connect("0xabc", "locus-browser-v1", "delegate-secret");
    expect(await client.recall("recent memory")).toEqual([]);
    expect(client.state().message).toMatch(/Restore index/i);
    await client.restore();
    expect(client.state()).toMatchObject({ status: "connected", usable: true });
    expect(client.state().message).toMatch(/1 restored, 2 already indexed/i);
    database.close();
  });

  it("keeps client-encrypted credentials in the vault and routes plaintext through the private bridge only", async () => {
    const database = new BrowserDatabase(join(mkdtempSync(join(tmpdir(), "locus-walrus-manual-")), "browser.sqlite3"));
    const configured: WalrusManualConfiguration[] = [];
    const remembered: string[] = [];
    const bridge = {
      configureWalrusManual: async (config: WalrusManualConfiguration) => { configured.push(config); return { signerAddress: "0xsigner" }; },
      disconnectWalrusManual: async () => undefined,
      walrusManualRemember: async (text: string) => { remembered.push(text); return { id: "manual-1", blob_id: "blob-manual", namespace: "locus-browser-v1" }; },
      walrusManualRecall: async () => ({ results: [{ blob_id: "blob-manual", text: serializePortableMemory({
        type: "page", title: "Encrypted finding", sourceUrl: "https://example.com/private",
        capturedAt: "2026-08-26T12:00:00.000Z", contentSha256: "d".repeat(64), body: "Decrypted locally.",
      }), distance: 0.2 }] }),
      walrusManualRestore: async () => ({ restored: 0, skipped: 1, total: 1, truncated: false }),
    };
    const client = new WalrusMemoryClient(database, cipher, "default", {
      packaged: true, createClient: () => fakeMemWal(), manualBridge: bridge,
    });
    await client.connect("0xabc", "locus-browser-v1", "delegate-secret");
    await client.configureClientEncrypted({
      network: "testnet", packageId: "0x123", registryId: "0x456",
      embeddingApiBase: "https://api.openai.com/v1", embeddingModel: "text-embedding-3-small",
      suiPrivateKey: "suiprivkey1dedicated", embeddingApiKey: "embedding-secret",
    });
    expect(client.state()).toMatchObject({
      mode: "client-encrypted", usable: true, manualConfigured: true, network: "testnet", signerAddress: "0xsigner",
    });
    expect(configured.at(-1)).toMatchObject({ delegateKey: "delegate-secret", suiPrivateKey: "suiprivkey1dedicated", embeddingApiKey: "embedding-secret" });
    const stored = JSON.stringify([
      database.setting("default", "walrusManualSuiCredentialV1"),
      database.setting("default", "walrusManualEmbeddingCredentialV1"),
    ]);
    expect(stored).not.toContain("suiprivkey1dedicated");
    expect(stored).not.toContain("embedding-secret");
    await client.remember("exact client-side preview");
    expect(remembered).toEqual(["exact client-side preview"]);
    expect(database.listWalrusMemoryReceipts("default")[0]).toMatchObject({ jobId: "manual-1", blobId: "blob-manual", status: "done" });
    expect(await client.recall("finding")).toEqual([expect.objectContaining({ title: "Encrypted finding", blobId: "blob-manual" })]);
    await client.disconnect();
    expect(database.setting("default", "walrusManualSuiCredentialV1")).toBeUndefined();
    expect(database.setting("default", "walrusManualEmbeddingCredentialV1")).toBeUndefined();
    database.close();
  });

  it("pins packaged builds to production and bounds development relayers", () => {
    expect(normalizeWalrusConfig("0xabc", "project.one", "https://custom.example.com", true).relayerUrl).toBe(WALRUS_PRODUCTION_RELAYER);
    expect(normalizeWalrusConfig("0xabc", "project.one", "http://127.0.0.1:8787", false).relayerUrl).toBe("http://127.0.0.1:8787");
    expect(() => normalizeWalrusConfig("wrong", "project", undefined, false)).toThrow("account ID");
    expect(() => normalizeWalrusConfig("0xabc", "bad namespace", undefined, false)).toThrow("Namespaces");
    expect(() => normalizeWalrusConfig("0xabc", "project", "http://relayer.example.com", false)).toThrow("HTTPS");
  });

  it("turns authentication, compatibility, rate, timeout, and offline failures into bounded diagnostics", () => {
    expect(safeWalrusError(new Error("401 unauthorized"))).toMatch(/delegate/i);
    expect(safeWalrusError(new Error("426 incompatible SDK"))).toMatch(/not compatible/i);
    expect(safeWalrusError(new Error("429 rate limit"))).toMatch(/rate limiting/i);
    expect(safeWalrusError(new Error("request timed out"))).toMatch(/receipt/i);
    expect(safeWalrusError(new Error("fetch failed ENOTFOUND"))).toMatch(/unreachable/i);
    expect(safeWalrusError(new Error("suiprivkey1secret unexpected"))).not.toContain("suiprivkey1secret");
  });
});
