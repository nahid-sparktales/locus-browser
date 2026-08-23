import { randomUUID } from "node:crypto";
import { BrowserWindow, dialog } from "electron";
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
  unwrapAccountKey,
  wrapAccountKey,
  type DeviceKeyPair,
  type EncryptedRecord,
} from "@locus/sync-crypto";
import { z } from "zod";
import type { RemoteTabState, SyncAccountState, SyncDeviceState } from "../shared/types.js";
import type { BrowserDatabase, StoredSyncAccount, SyncQueueRecord } from "./BrowserDatabase.js";
import type { CredentialCipher } from "./CredentialVault.js";
import { assertSyncKeyVerifier, createSyncKeyVerifier, SYNC_KEY_VERIFIER_RECORD_ID } from "./SyncKeyVerifier.js";

const StartCeremonySchema = z.object({ ceremonyId: z.string().uuid(), authUrl: z.string().url() });
const ClaimSchema = z.object({ accountId: z.string().min(1), deviceId: z.string().min(1), deviceToken: z.string().min(32) });
const KeyStateSchema = z.object({ version: z.number().int().nonnegative(), wrappedAccountKey: z.string().optional() });
const EnrollmentStartSchema = z.object({ enrollmentId: z.string().uuid(), approvalCode: z.string().min(20), expiresInSeconds: z.number().int().positive() });
const EnrollmentClaimSchema = z.object({
  accountId: z.string().min(1),
  deviceId: z.string().min(1),
  deviceToken: z.string().min(32),
  wrappedAccountKey: z.string().min(32),
  keyVersion: z.number().int().positive(),
});
const EnrollmentDetailsSchema = z.object({
  deviceId: z.string().min(1),
  deviceName: z.string().min(1),
  publicKey: z.string().min(32),
  expiresAt: z.number().int().positive(),
});
const DevicesSchema = z.object({ devices: z.array(z.object({
  deviceId: z.string().min(1),
  name: z.string().min(1),
  publicKey: z.string().min(1),
  keyVersion: z.number().int().nonnegative(),
  createdAt: z.number().int().nonnegative(),
  lastSeenAt: z.number().int().nonnegative(),
  current: z.boolean(),
})).max(100) });
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

interface PendingEnrollment {
  serviceUrl: string;
  enrollmentId: string;
  approvalCode: string;
  deviceId: string;
  device: DeviceKeyPair;
  expiresAt: number;
}

type ServiceDevice = z.infer<typeof DevicesSchema>["devices"][number];

export class SyncAccountManager {
  readonly #database: BrowserDatabase;
  readonly #cipher: CredentialCipher;
  readonly #profileId: string;
  readonly #deviceName: string;
  readonly #parent: BrowserWindow;
  readonly #onChanged: () => void;
  readonly #onDataApplied: () => void;
  readonly #onRecoveryKey: (recoveryKey: string) => void;
  #transientStatus: SyncAccountState["status"] | undefined;
  #transientServiceUrl: string | undefined;
  #lastError: string | undefined;
  #ceremonyWindow: BrowserWindow | undefined;
  #pendingEnrollment: PendingEnrollment | undefined;
  #enrollmentTimer: NodeJS.Timeout | undefined;
  #enrollmentClaimPromise: Promise<void> | undefined;
  #devices: ServiceDevice[] = [];
  #syncPromise: Promise<void> | undefined;
  #syncTimer: NodeJS.Timeout | undefined;
  #pollTimer: NodeJS.Timeout;
  #disposed = false;

  constructor(options: {
    database: BrowserDatabase;
    cipher: CredentialCipher;
    profileId: string;
    deviceName: string;
    parent: BrowserWindow;
    onChanged: () => void;
    onDataApplied: () => void;
    onRecoveryKey: (recoveryKey: string) => void;
  }) {
    this.#database = options.database;
    this.#cipher = options.cipher;
    this.#profileId = options.profileId;
    this.#deviceName = options.deviceName;
    this.#parent = options.parent;
    this.#onChanged = options.onChanged;
    this.#onDataApplied = options.onDataApplied;
    this.#onRecoveryKey = options.onRecoveryKey;
    const account = this.#database.syncAccount(this.#profileId);
    if (account?.status === "syncing") this.#database.updateSyncAccountStatus(this.#profileId, "connected");
    this.#pollTimer = setInterval(() => this.scheduleSync(), 5 * 60 * 1_000);
    if (account) {
      this.scheduleSync();
      void this.#refreshDevices().catch((error) => this.#handleError(error));
    }
  }

  state(): SyncAccountState {
    const account = this.#database.syncAccount(this.#profileId);
    const serviceUrl = account?.serviceUrl ?? this.#transientServiceUrl;
    const lastError = account?.lastError ?? this.#lastError;
    return {
      status: this.#transientStatus ?? account?.status ?? "disconnected",
      ...(serviceUrl ? { serviceUrl } : {}),
      ...(account ? { accountId: account.accountId, deviceId: account.deviceId, keyVersion: account.keyVersion } : {}),
      ...(account?.lastSyncedAt ? { lastSyncedAt: account.lastSyncedAt } : {}),
      ...(lastError ? { lastError } : {}),
      pendingRecords: account ? this.#database.syncOutboxCount(this.#profileId) : 0,
      devices: this.#deviceStates(),
      ...(this.#pendingEnrollment ? {
        pendingEnrollment: {
          pairingCode: formatPairingCode(this.#pendingEnrollment.enrollmentId, this.#pendingEnrollment.approvalCode),
          expiresAt: Math.floor(this.#pendingEnrollment.expiresAt / 1_000),
        },
      } : {}),
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

  async beginDeviceEnrollment(rawServiceUrl: string): Promise<void> {
    if (this.#database.syncAccount(this.#profileId)) throw new Error("This profile is already connected to sync");
    if (!this.#cipher.available()) throw new Error("OS-backed sync-key encryption is unavailable");
    this.cancelDeviceEnrollment();
    const serviceUrl = normalizeServiceUrl(rawServiceUrl);
    const device = await generateDeviceKeyPair();
    const deviceId = randomDeviceId();
    const started = EnrollmentStartSchema.parse(await this.#request(serviceUrl, "/v1/devices/enrollments", {
      method: "POST",
      body: JSON.stringify({ deviceId, deviceName: this.#deviceName, publicKey: device.publicKey }),
    }));
    this.#pendingEnrollment = {
      serviceUrl,
      enrollmentId: started.enrollmentId,
      approvalCode: started.approvalCode,
      deviceId,
      device,
      expiresAt: Date.now() + started.expiresInSeconds * 1_000,
    };
    this.#transientStatus = "waiting-for-approval";
    this.#transientServiceUrl = serviceUrl;
    this.#lastError = undefined;
    this.#changed();
    this.#scheduleEnrollmentCheck();
  }

  checkDeviceEnrollment(): void {
    if (!this.#pendingEnrollment || this.#disposed || this.#enrollmentClaimPromise) return;
    if (this.#enrollmentTimer) clearTimeout(this.#enrollmentTimer);
    this.#enrollmentTimer = undefined;
    this.#enrollmentClaimPromise = this.#claimDeviceEnrollment()
      .catch((error) => this.#handleError(error))
      .finally(() => { this.#enrollmentClaimPromise = undefined; });
  }

  cancelDeviceEnrollment(): void {
    if (this.#enrollmentTimer) clearTimeout(this.#enrollmentTimer);
    this.#enrollmentTimer = undefined;
    this.#pendingEnrollment = undefined;
    if (!this.#database.syncAccount(this.#profileId)) {
      this.#transientStatus = undefined;
      this.#transientServiceUrl = undefined;
      this.#lastError = undefined;
    }
    this.#changed();
  }

  async approveDevice(pairingCode: string): Promise<void> {
    const account = this.#requireAccount();
    const { enrollmentId, approvalCode } = parsePairingCode(pairingCode);
    const { token, accountKey } = this.#secrets(account);
    const details = EnrollmentDetailsSchema.parse(await this.#request(
      account.serviceUrl,
      `/v1/devices/enrollments/${encodeURIComponent(enrollmentId)}/details`,
      { method: "POST", body: JSON.stringify({ approvalCode }) },
      token,
    ));
    const confirmation = await dialog.showMessageBox(this.#parent, {
      type: "question",
      title: "Approve sync device",
      message: `Approve “${details.deviceName}”?`,
      detail: "This device will receive an encrypted copy of your sync key and can access the browser data selected for Locus Sync.",
      buttons: ["Approve device", "Cancel"],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
    if (confirmation.response !== 0) return;
    const wrappedAccountKey = await wrapAccountKey(accountKey, details.publicKey);
    await this.#request(account.serviceUrl, `/v1/devices/enrollments/${encodeURIComponent(enrollmentId)}/approve`, {
      method: "POST",
      body: JSON.stringify({ approvalCode, wrappedAccountKey }),
    }, token);
    await this.#refreshDevices();
  }

  async revokeDevice(deviceId: string): Promise<void> {
    const account = this.#requireAccount();
    if (deviceId === account.deviceId) throw new Error("Disconnect this Mac instead of revoking it here");
    const device = this.#devices.find((entry) => entry.deviceId === deviceId);
    if (!device) throw new Error("Device is unavailable");
    const confirmation = await dialog.showMessageBox(this.#parent, {
      type: "warning",
      title: "Revoke sync device",
      message: `Revoke “${device.name}”?`,
      detail: "It will stop receiving encrypted browser updates. Browser data already stored on that device will remain there.",
      buttons: ["Revoke device", "Cancel"],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
    if (confirmation.response !== 0) return;
    const { token } = this.#secrets(account);
    await this.#request(account.serviceUrl, `/v1/devices/${encodeURIComponent(deviceId)}`, { method: "DELETE" }, token);
    await this.#refreshDevices();
  }

  async rotateRecoveryKey(): Promise<void> {
    const confirmation = await dialog.showMessageBox(this.#parent, {
      type: "warning",
      title: "Rotate recovery key",
      message: "Create a new recovery key?",
      detail: "Every active device will receive the new encrypted account key. Your old recovery key will stop working immediately.",
      buttons: ["Rotate key", "Cancel"],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
    if (confirmation.response !== 0) return;
    if (this.#syncPromise) await this.#syncPromise;
    else {
      try { await this.#runSync(); }
      catch (error) { this.#handleError(error); throw error; }
    }
    const synchronized = this.#requireAccount();
    if (synchronized.status === "error") throw new Error(synchronized.lastError ?? "Sync must complete before rotating the recovery key");
    const account = synchronized;
    const { token, accountKey } = this.#secrets(account);
    const encryptedRecords = await this.#pullAllRecords(account.serviceUrl, token);
    if (!encryptedRecords.length) throw new Error("Sync account has no encrypted key verifier");
    if (encryptedRecords.length > 500) throw new Error("Recovery-key rotation currently supports up to 500 sync records");
    const values = await Promise.all(encryptedRecords.map(async (record) => ({
      record,
      value: await decryptRecord(accountKey, record),
    })));
    const nextAccountKey = await generateAccountKey();
    const nextVersion = account.keyVersion + 1;
    const clock = new HybridLogicalClock(account.deviceId);
    for (const { record } of values) clock.observe(record.clock);
    const records = await Promise.all(values.map(async ({ record, value }) => await encryptRecord(nextAccountKey, {
      accountId: account.accountId,
      deviceId: account.deviceId,
      collection: record.collection,
      recordId: record.recordId,
      clock: clock.tick(),
      tombstone: record.tombstone,
    }, value)));
    const devices = await this.#fetchDevices(account, token);
    const wraps = await Promise.all(devices.map(async (device) => ({
      deviceId: device.deviceId,
      wrappedAccountKey: await wrapAccountKey(nextAccountKey, device.publicKey),
    })));
    await this.#request(account.serviceUrl, "/v1/account/key/rotate", {
      method: "POST",
      body: JSON.stringify({ expectedVersion: account.keyVersion, version: nextVersion, wraps, records }),
    }, token);
    this.#database.updateSyncAccountKey(this.#profileId, this.#cipher.encrypt(nextAccountKey), nextVersion);
    this.#database.resetSyncData(this.#profileId);
    this.#onRecoveryKey(createRecoveryKey(nextAccountKey));
    await this.#refreshDevices();
    this.syncNow();
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
    if (this.#enrollmentTimer) clearTimeout(this.#enrollmentTimer);
    this.#enrollmentTimer = undefined;
    this.#pendingEnrollment = undefined;
    this.#devices = [];
    this.#transientStatus = undefined;
    this.#transientServiceUrl = undefined;
    this.#lastError = undefined;
    this.#changed();
  }

  dispose(): void {
    this.#disposed = true;
    if (this.#syncTimer) clearTimeout(this.#syncTimer);
    if (this.#enrollmentTimer) clearTimeout(this.#enrollmentTimer);
    clearInterval(this.#pollTimer);
    this.#ceremonyWindow?.destroy();
  }

  #begin(kind: "register" | "authenticate", rawServiceUrl: string, displayName?: string, recoveredAccountKey?: string): void {
    if (this.#transientStatus === "connecting" || this.#ceremonyWindow || this.#pendingEnrollment) throw new Error("Another sync connection request is already active");
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
        deviceName: this.#deviceName,
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
    let keyVersion: number;
    try {
      if (kind === "register") {
        keyVersion = 1;
        const wrappedAccountKey = await wrapAccountKey(pending.accountKey, pending.device.publicKey);
        KeyStateSchema.parse(await this.#request(serviceUrl, "/v1/account/key", {
          method: "PUT",
          body: JSON.stringify({
            expectedVersion: 0,
            version: keyVersion,
            wraps: [{ deviceId: pending.deviceId, wrappedAccountKey }],
          }),
        }, claim.deviceToken));
        const verifier = await createSyncKeyVerifier(
          pending.accountKey,
          claim.accountId,
          pending.deviceId,
          new HybridLogicalClock(pending.deviceId).tick(),
        );
        const pushed = PushResponseSchema.parse(await this.#request(serviceUrl, "/v1/sync/push", {
          method: "POST",
          body: JSON.stringify({ keyVersion, records: [verifier] }),
        }, claim.deviceToken));
        if (pushed.accepted !== 1) throw new Error("Could not initialize encrypted sync");
      } else {
        const keyState = KeyStateSchema.parse(await this.#request(serviceUrl, "/v1/account/key", {}, claim.deviceToken));
        if (!keyState.version) throw new Error("Sync account key is not initialized");
        keyVersion = keyState.version;
        await this.#verifyRecoveredAccountKey(serviceUrl, claim.deviceToken, pending.accountKey);
        const wrappedAccountKey = await wrapAccountKey(pending.accountKey, pending.device.publicKey);
        await this.#request(serviceUrl, "/v1/devices/self/key", {
          method: "PUT",
          body: JSON.stringify({ version: keyVersion, wrappedAccountKey }),
        }, claim.deviceToken);
      }
    } catch (error) {
      const path = kind === "register" ? "/v1/account" : "/v1/devices/self";
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
      keyVersion,
      status: "connected",
    });
    if (pending.recoveryKey) this.#onRecoveryKey(pending.recoveryKey);
    this.#transientStatus = undefined;
    this.#transientServiceUrl = undefined;
    this.#lastError = undefined;
    await this.#refreshDevices();
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

  #scheduleEnrollmentCheck(): void {
    if (this.#enrollmentTimer) clearTimeout(this.#enrollmentTimer);
    this.#enrollmentTimer = setTimeout(() => {
      this.#enrollmentTimer = undefined;
      this.checkDeviceEnrollment();
    }, 3_000);
  }

  async #claimDeviceEnrollment(): Promise<void> {
    const pending = this.#pendingEnrollment;
    if (!pending) return;
    if (pending.expiresAt <= Date.now()) {
      this.#pendingEnrollment = undefined;
      throw new Error("Device approval expired. Start again to get a new pairing code.");
    }
    const claimed = await this.#optionalRequest(pending.serviceUrl, "/v1/devices/enrollments/claim", {
      method: "POST",
      body: JSON.stringify({ enrollmentId: pending.enrollmentId, approvalCode: pending.approvalCode }),
    });
    if (!claimed) {
      if (this.#pendingEnrollment === pending) this.#scheduleEnrollmentCheck();
      return;
    }
    if (this.#pendingEnrollment !== pending) return;
    const delivery = EnrollmentClaimSchema.parse(claimed);
    if (delivery.deviceId !== pending.deviceId) throw new Error("Enrollment was issued to another device");
    const accountKey = await unwrapAccountKey(delivery.wrappedAccountKey, pending.device);
    await this.#verifyRecoveredAccountKey(pending.serviceUrl, delivery.deviceToken, accountKey);
    this.#database.saveSyncAccount({
      profileId: this.#profileId,
      serviceUrl: pending.serviceUrl,
      accountId: delivery.accountId,
      deviceId: pending.deviceId,
      devicePublicKey: pending.device.publicKey,
      encryptedDevicePrivateKey: this.#cipher.encrypt(pending.device.privateKey),
      encryptedDeviceToken: this.#cipher.encrypt(delivery.deviceToken),
      encryptedAccountKey: this.#cipher.encrypt(accountKey),
      keyVersion: delivery.keyVersion,
      status: "connected",
    });
    this.#pendingEnrollment = undefined;
    this.#transientStatus = undefined;
    this.#transientServiceUrl = undefined;
    this.#lastError = undefined;
    await this.#refreshDevices();
    this.#changed();
    this.syncNow();
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
    let account = this.#requireAccount();
    let { token, accountKey } = this.#secrets(account);
    const refreshed = await this.#refreshAccountKey(account, token);
    account = refreshed.account;
    accountKey = refreshed.accountKey;
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
        body: JSON.stringify({ keyVersion: account.keyVersion, records }),
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
    await this.#refreshDevices();
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

  async #refreshAccountKey(account: StoredSyncAccount, token: string): Promise<{ account: StoredSyncAccount; accountKey: string }> {
    const state = KeyStateSchema.parse(await this.#request(account.serviceUrl, "/v1/account/key", {}, token));
    if (state.version < account.keyVersion) throw new Error("Sync service returned an older account key version");
    if (state.version === account.keyVersion) return { account, accountKey: this.#cipher.decrypt(account.encryptedAccountKey) };
    if (!state.wrappedAccountKey) throw new Error("This device has not received the newest sync key");
    const privateKey = this.#cipher.decrypt(account.encryptedDevicePrivateKey);
    const accountKey = await unwrapAccountKey(state.wrappedAccountKey, { publicKey: account.devicePublicKey, privateKey });
    await this.#verifyRecoveredAccountKey(account.serviceUrl, token, accountKey);
    this.#database.updateSyncAccountKey(this.#profileId, this.#cipher.encrypt(accountKey), state.version);
    const updated = this.#requireAccount();
    return { account: updated, accountKey };
  }

  async #refreshDevices(): Promise<void> {
    const account = this.#database.syncAccount(this.#profileId);
    if (!account) {
      this.#devices = [];
      return;
    }
    const { token } = this.#secrets(account);
    this.#devices = await this.#fetchDevices(account, token);
    this.#changed();
  }

  async #fetchDevices(account: StoredSyncAccount, token: string): Promise<ServiceDevice[]> {
    return DevicesSchema.parse(await this.#request(account.serviceUrl, "/v1/devices", {}, token)).devices;
  }

  #deviceStates(): SyncDeviceState[] {
    return this.#devices.map((device) => ({
      deviceId: device.deviceId,
      name: device.name,
      current: device.current,
      keyVersion: device.keyVersion,
      createdAt: Math.floor(device.createdAt / 1_000),
      lastSeenAt: Math.floor(device.lastSeenAt / 1_000),
    }));
  }

  async #pullAllRecords(serviceUrl: string, token: string): Promise<EncryptedRecord[]> {
    const records: EncryptedRecord[] = [];
    let cursor = 0;
    for (let page = 0; page < 100; page += 1) {
      const pulled = PullResponseSchema.parse(await this.#request(serviceUrl, `/v1/sync/pull?cursor=${cursor}&limit=500`, {}, token));
      records.push(...pulled.records.map((record) => EncryptedRecordSchema.parse(record)));
      if (!pulled.hasMore) return records;
      if (pulled.cursor <= cursor) throw new Error("Sync service returned a non-advancing cursor");
      cursor = pulled.cursor;
    }
    throw new Error("Sync account exceeds the supported rotation scan size");
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

  async #optionalRequest(serviceUrl: string, path: string, init: RequestInit): Promise<unknown | undefined> {
    const response = await fetch(`${serviceUrl}${path}`, {
      ...init,
      signal: AbortSignal.timeout(20_000),
      headers: { "content-type": "application/json", ...init.headers },
      redirect: "error",
    });
    if (response.status === 404) return undefined;
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

function formatPairingCode(enrollmentId: string, approvalCode: string): string {
  return `LOCUS-DEVICE:${enrollmentId}:${approvalCode}`;
}

function parsePairingCode(value: string): { enrollmentId: string; approvalCode: string } {
  const match = /^LOCUS-DEVICE:([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}):([A-Za-z0-9_-]{20,128})$/i.exec(value.trim());
  if (!match) throw new Error("Enter the complete Locus device pairing code");
  return { enrollmentId: match[1]!, approvalCode: match[2]! };
}
