import { randomUUID } from "node:crypto";
import { BrowserWindow } from "electron";
import {
  EncryptedRecordSchema,
  HybridLogicalClock,
  createRecoveryKey,
  decryptRecord,
  encryptRecord,
  generateAccountKey,
  generateDeviceKeyPair,
  randomDeviceId,
  recoverAccountKey,
  type DeviceKeyPair,
} from "@locus/sync-crypto";
import { z } from "zod";
import type { RemoteTabState, SyncAccountState } from "../shared/types.js";
import type { BrowserDatabase, StoredSyncAccount, SyncQueueRecord } from "./BrowserDatabase.js";
import type { CredentialCipher } from "./CredentialVault.js";
import { assertSyncKeyVerifier, createSyncKeyVerifier, SYNC_KEY_VERIFIER_RECORD_ID } from "./SyncKeyVerifier.js";

const StartCeremonySchema = z.object({ ceremonyId: z.string().uuid(), authUrl: z.string().url() });
const ClaimSchema = z.object({ accountId: z.string().min(1), deviceId: z.string().min(1), deviceToken: z.string().min(32) });
const PushResponseSchema = z.object({ accepted: z.number().int().nonnegative(), cursor: z.number().int().nonnegative() });
const PullResponseSchema = z.object({
  records: z.array(z.object({
    version: z.literal(1),
    accountId: z.string(),
    deviceId: z.string(),
    collection: z.enum(["bookmarks", "history", "tab-groups", "remote-tabs", "settings", "extensions"]),
    recordId: z.string(),
    clock: z.string(),
    nonce: z.string(),
    ciphertext: z.string(),
    tombstone: z.boolean(),
    cursor: z.number().int().nonnegative(),
  })).max(500),
  cursor: z.number().int().nonnegative(),
  hasMore: z.boolean(),
});

interface PendingCeremony {
  serviceUrl: string;
  deviceId: string;
  device: DeviceKeyPair;
  accountKey: string;
  recoveryKey?: string;
}

export class SyncAccountManager {
  readonly #database: BrowserDatabase;
  readonly #cipher: CredentialCipher;
  readonly #profileId: string;
  readonly #parent: BrowserWindow;
  readonly #onChanged: () => void;
  readonly #onDataApplied: () => void;
  readonly #onRecoveryKey: (recoveryKey: string) => void;
  #transientStatus: SyncAccountState["status"] | undefined;
  #transientServiceUrl: string | undefined;
  #lastError: string | undefined;
  #ceremonyWindow: BrowserWindow | undefined;
  #syncPromise: Promise<void> | undefined;
  #syncTimer: NodeJS.Timeout | undefined;
  #pollTimer: NodeJS.Timeout;
  #disposed = false;

  constructor(options: {
    database: BrowserDatabase;
    cipher: CredentialCipher;
    profileId: string;
    parent: BrowserWindow;
    onChanged: () => void;
    onDataApplied: () => void;
    onRecoveryKey: (recoveryKey: string) => void;
  }) {
    this.#database = options.database;
    this.#cipher = options.cipher;
    this.#profileId = options.profileId;
    this.#parent = options.parent;
    this.#onChanged = options.onChanged;
    this.#onDataApplied = options.onDataApplied;
    this.#onRecoveryKey = options.onRecoveryKey;
    const account = this.#database.syncAccount(this.#profileId);
    if (account?.status === "syncing") this.#database.updateSyncAccountStatus(this.#profileId, "connected");
    this.#pollTimer = setInterval(() => this.scheduleSync(), 5 * 60 * 1_000);
    if (account) this.scheduleSync();
  }

  state(): SyncAccountState {
    const account = this.#database.syncAccount(this.#profileId);
    const serviceUrl = account?.serviceUrl ?? this.#transientServiceUrl;
    const lastError = account?.lastError ?? this.#lastError;
    return {
      status: this.#transientStatus ?? account?.status ?? "disconnected",
      ...(serviceUrl ? { serviceUrl } : {}),
      ...(account ? { accountId: account.accountId, deviceId: account.deviceId } : {}),
      ...(account?.lastSyncedAt ? { lastSyncedAt: account.lastSyncedAt } : {}),
      ...(lastError ? { lastError } : {}),
      pendingRecords: account ? this.#database.syncOutboxCount(this.#profileId) : 0,
    };
  }

  remoteTabs(): RemoteTabState[] {
    const account = this.#database.syncAccount(this.#profileId);
    return account ? this.#database.listRemoteTabs(this.#profileId, account.deviceId) : [];
  }

  beginRegistration(displayName: string, rawServiceUrl: string): void {
    if (this.#database.syncAccount(this.#profileId)) throw new Error("This profile is already connected to sync");
    this.#begin("register", rawServiceUrl, displayName);
  }

  beginSignIn(recoveryKey: string, rawServiceUrl: string): void {
    if (this.#database.syncAccount(this.#profileId)) throw new Error("This profile is already connected to sync");
    const accountKey = recoverAccountKey(recoveryKey);
    this.#begin("authenticate", rawServiceUrl, undefined, accountKey);
  }

  scheduleSync(): void {
    if (!this.#database.syncAccount(this.#profileId) || this.#disposed) return;
    if (this.#syncTimer) clearTimeout(this.#syncTimer);
    this.#syncTimer = setTimeout(() => {
      this.#syncTimer = undefined;
      this.syncNow();
    }, 1_000);
  }

  syncNow(): void {
    if (this.#syncPromise || !this.#database.syncAccount(this.#profileId) || this.#disposed) return;
    this.#syncPromise = this.#runSync()
      .catch((error) => this.#handleError(error))
      .finally(() => { this.#syncPromise = undefined; });
  }

  async deleteCloudData(): Promise<void> {
    const account = this.#requireAccount();
    const { token } = this.#secrets(account);
    await this.#request(account.serviceUrl, "/v1/sync/cloud-data", { method: "DELETE" }, token);
    this.#database.resetSyncData(this.#profileId);
    this.#changed();
  }

  async deleteAccount(): Promise<void> {
    const account = this.#requireAccount();
    const { token } = this.#secrets(account);
    await this.#request(account.serviceUrl, "/v1/account", { method: "DELETE" }, token);
    this.disconnect();
  }

  disconnect(): void {
    this.#database.deleteSyncAccount(this.#profileId);
    this.#transientStatus = undefined;
    this.#transientServiceUrl = undefined;
    this.#lastError = undefined;
    this.#changed();
  }

  dispose(): void {
    this.#disposed = true;
    if (this.#syncTimer) clearTimeout(this.#syncTimer);
    clearInterval(this.#pollTimer);
    this.#ceremonyWindow?.destroy();
  }

  #begin(kind: "register" | "authenticate", rawServiceUrl: string, displayName?: string, recoveredAccountKey?: string): void {
    if (this.#transientStatus === "connecting" || this.#ceremonyWindow) throw new Error("A passkey request is already active");
    if (!this.#cipher.available()) throw new Error("OS-backed sync-key encryption is unavailable");
    const serviceUrl = normalizeServiceUrl(rawServiceUrl);
    this.#transientStatus = "connecting";
    this.#transientServiceUrl = serviceUrl;
    this.#lastError = undefined;
    this.#changed();
    void this.#completeCeremony(kind, serviceUrl, displayName, recoveredAccountKey).catch((error) => this.#handleError(error));
  }

  async #completeCeremony(kind: "register" | "authenticate", serviceUrl: string, displayName?: string, recoveredAccountKey?: string): Promise<void> {
    const [device, generatedAccountKey] = await Promise.all([
      generateDeviceKeyPair(),
      recoveredAccountKey ? Promise.resolve(recoveredAccountKey) : generateAccountKey(),
    ]);
    const pending: PendingCeremony = {
      serviceUrl,
      deviceId: randomDeviceId(),
      device,
      accountKey: generatedAccountKey,
      ...(kind === "register" ? { recoveryKey: createRecoveryKey(generatedAccountKey) } : {}),
    };
    const path = kind === "register" ? "/v1/auth/passkeys/register/options" : "/v1/auth/passkeys/authenticate/options";
    const started = StartCeremonySchema.parse(await this.#request(serviceUrl, path, {
      method: "POST",
      body: JSON.stringify({
        ...(displayName ? { displayName } : {}),
        deviceId: pending.deviceId,
        devicePublicKey: pending.device.publicKey,
      }),
    }));
    const authUrl = new URL(started.authUrl);
    if (authUrl.origin !== serviceUrl || !authUrl.pathname.startsWith("/v1/auth/passkeys/ceremonies/")) {
      throw new Error("Sync service returned an untrusted passkey URL");
    }
    const callback = await this.#openPasskeyWindow(authUrl.toString());
    const claim = ClaimSchema.parse(await this.#request(serviceUrl, "/v1/auth/passkeys/claims", {
      method: "POST",
      body: JSON.stringify(callback),
    }));
    if (claim.deviceId !== pending.deviceId) throw new Error("Passkey claim was issued to another device");
    try {
      if (kind === "register") {
        const verifier = await createSyncKeyVerifier(
          pending.accountKey,
          claim.accountId,
          pending.deviceId,
          new HybridLogicalClock(pending.deviceId).tick(),
        );
        const pushed = PushResponseSchema.parse(await this.#request(serviceUrl, "/v1/sync/push", {
          method: "POST",
          body: JSON.stringify({ records: [verifier] }),
        }, claim.deviceToken));
        if (pushed.accepted !== 1) throw new Error("Could not initialize encrypted sync");
      } else {
        await this.#verifyRecoveredAccountKey(serviceUrl, claim.deviceToken, pending.accountKey);
      }
    } catch (error) {
      const path = kind === "register" ? "/v1/account" : `/v1/devices/${encodeURIComponent(pending.deviceId)}`;
      await this.#request(serviceUrl, path, { method: "DELETE" }, claim.deviceToken).catch(() => undefined);
      throw error;
    }
    this.#database.saveSyncAccount({
      profileId: this.#profileId,
      serviceUrl,
      accountId: claim.accountId,
      deviceId: pending.deviceId,
      devicePublicKey: pending.device.publicKey,
      encryptedDevicePrivateKey: this.#cipher.encrypt(pending.device.privateKey),
      encryptedDeviceToken: this.#cipher.encrypt(claim.deviceToken),
      encryptedAccountKey: this.#cipher.encrypt(pending.accountKey),
      status: "connected",
    });
    if (pending.recoveryKey) this.#onRecoveryKey(pending.recoveryKey);
    this.#transientStatus = undefined;
    this.#transientServiceUrl = undefined;
    this.#lastError = undefined;
    this.#changed();
    this.syncNow();
  }

  async #verifyRecoveredAccountKey(serviceUrl: string, deviceToken: string, accountKey: string): Promise<void> {
    let cursor = 0;
    for (let page = 0; page < 100; page += 1) {
      const pulled = PullResponseSchema.parse(await this.#request(
        serviceUrl,
        `/v1/sync/pull?cursor=${cursor}&limit=500`,
        {},
        deviceToken,
      ));
      const verifier = pulled.records.find((record) =>
        record.collection === "settings" && record.recordId === SYNC_KEY_VERIFIER_RECORD_ID && !record.tombstone);
      if (verifier) return await assertSyncKeyVerifier(accountKey, verifier);
      if (!pulled.hasMore) break;
      if (pulled.cursor <= cursor) throw new Error("Sync service returned a non-advancing cursor");
      cursor = pulled.cursor;
    }
    throw new Error("This sync account has no recovery-key verifier");
  }

  async #openPasskeyWindow(authUrl: string): Promise<{ claimId: string; claimCode: string }> {
    if (this.#disposed) throw new Error("Sync manager is closed");
    const expectedOrigin = new URL(authUrl).origin;
    const window = new BrowserWindow({
      parent: this.#parent,
      modal: true,
      show: false,
      width: 520,
      height: 650,
      minWidth: 420,
      minHeight: 520,
      title: "Locus Sync",
      backgroundColor: "#1b1b17",
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        partition: `locus-passkey-${randomUUID()}`,
      },
    });
    this.#ceremonyWindow = window;
    window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    window.webContents.on("will-attach-webview", (event) => event.preventDefault());
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.once("ready-to-show", () => window.show());
    return await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback?: { claimId: string; claimCode: string }, error?: Error) => {
        if (settled) return;
        settled = true;
        this.#ceremonyWindow = undefined;
        if (!window.isDestroyed()) window.destroy();
        if (callback) resolve(callback); else reject(error ?? new Error("Passkey request was cancelled"));
      };
      const inspectNavigation = (event: Electron.Event, rawUrl: string) => {
        let target: URL;
        try { target = new URL(rawUrl); } catch { event.preventDefault(); return; }
        if (target.protocol === "locus-browser:" && target.hostname === "sync-auth" && target.pathname === "/callback") {
          event.preventDefault();
          const claimId = target.searchParams.get("claimId");
          const claimCode = target.searchParams.get("claimCode");
          if (!claimId || !claimCode) return finish(undefined, new Error("Passkey callback is incomplete"));
          return finish({ claimId, claimCode });
        }
        if (target.origin !== expectedOrigin) event.preventDefault();
      };
      window.webContents.on("will-navigate", (event, url) => inspectNavigation(event, url));
      window.webContents.on("will-redirect", (event, url) => inspectNavigation(event, url));
      window.once("closed", () => finish(undefined, new Error("Passkey request was cancelled")));
      void window.loadURL(authUrl).catch((error) => finish(undefined, error));
    });
  }

  async #runSync(): Promise<void> {
    const account = this.#requireAccount();
    const { token, accountKey } = this.#secrets(account);
    this.#database.updateSyncAccountStatus(this.#profileId, "syncing");
    this.#changed();
    const progress = this.#database.syncProgress(this.#profileId);
    const clock = new HybridLogicalClock(account.deviceId);
    let lastClock = progress.lastClock ? clock.observe(progress.lastClock) : undefined;
    this.#database.queueSyncSnapshot(this.#profileId, account.deviceId, () => {
      lastClock = clock.tick();
      return lastClock;
    });
    while (true) {
      const batch = this.#database.syncOutbox(this.#profileId, 500);
      if (!batch.length) break;
      const records = await Promise.all(batch.map(async (record) => await encryptRecord(accountKey, {
        accountId: account.accountId,
        deviceId: account.deviceId,
        collection: record.collection,
        recordId: record.recordId,
        clock: record.clock,
        tombstone: record.tombstone,
      }, record.value)));
      PushResponseSchema.parse(await this.#request(account.serviceUrl, "/v1/sync/push", {
        method: "POST",
        body: JSON.stringify({ records }),
      }, token));
      this.#database.clearSyncOutbox(this.#profileId, batch);
    }
    let cursor = progress.cursor;
    while (true) {
      const pulled = PullResponseSchema.parse(await this.#request(account.serviceUrl, `/v1/sync/pull?cursor=${cursor}&limit=500`, {}, token));
      for (const record of pulled.records) {
        try {
          const encrypted = EncryptedRecordSchema.parse(record);
          const value = await decryptRecord(accountKey, encrypted);
          this.#database.applyPulledSyncRecord(this.#profileId, {
            collection: encrypted.collection,
            recordId: encrypted.recordId,
            clock: encrypted.clock,
            tombstone: encrypted.tombstone,
            value,
            deviceId: encrypted.deviceId,
          });
          lastClock = clock.observe(encrypted.clock);
        } catch {
          // Authenticated decryption failures are skipped so a malformed cloud
          // record cannot permanently pin the cursor and deny future sync.
        }
      }
      cursor = pulled.cursor;
      this.#database.setSyncProgress(this.#profileId, cursor, lastClock);
      if (!pulled.hasMore) break;
    }
    this.#database.cleanupExpiredSyncTombstones(this.#profileId);
    this.#database.updateSyncAccountStatus(this.#profileId, "connected", undefined, true);
    this.#onDataApplied();
    this.#changed();
  }

  #requireAccount(): StoredSyncAccount {
    const account = this.#database.syncAccount(this.#profileId);
    if (!account) throw new Error("This profile is not connected to sync");
    return account;
  }

  #secrets(account: StoredSyncAccount): { token: string; accountKey: string } {
    if (!this.#cipher.available()) throw new Error("OS-backed sync-key encryption is unavailable");
    return {
      token: this.#cipher.decrypt(account.encryptedDeviceToken),
      accountKey: this.#cipher.decrypt(account.encryptedAccountKey),
    };
  }

  async #request(serviceUrl: string, path: string, init: RequestInit, token?: string): Promise<unknown> {
    const response = await fetch(`${serviceUrl}${path}`, {
      ...init,
      signal: AbortSignal.timeout(20_000),
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
      redirect: "error",
    });
    const body = await response.json().catch(() => ({ error: `Sync service returned ${response.status}` })) as { error?: unknown };
    if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : `Sync service returned ${response.status}`);
    return body;
  }

  #handleError(error: unknown): void {
    const message = error instanceof Error ? error.message : "Sync failed";
    const account = this.#database.syncAccount(this.#profileId);
    if (account) this.#database.updateSyncAccountStatus(this.#profileId, "error", message);
    else this.#transientStatus = "error";
    this.#lastError = message;
    this.#ceremonyWindow?.destroy();
    this.#ceremonyWindow = undefined;
    this.#changed();
  }

  #changed(): void {
    if (!this.#disposed) this.#onChanged();
  }
}

function normalizeServiceUrl(value: string): string {
  const url = new URL(value);
  if (url.username || url.password || (url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) {
    throw new Error("Enter only the sync service origin");
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) {
    throw new Error("Sync requires HTTPS except during local development");
  }
  return url.origin;
}
