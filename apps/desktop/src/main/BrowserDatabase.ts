import { mkdirSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";

// Keep the built-in specifier intact when the Electron main process is bundled.
// Some bundlers otherwise rewrite the newer `node:sqlite` module to `sqlite`.
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

export interface StoredTab {
  id: string;
  windowId: string;
  profileId: string;
  position: number;
  url: string;
  title: string;
  active: boolean;
  muted: boolean;
  pinned: boolean;
  private: boolean;
  groupId?: string;
}

export interface StoredWindow {
  id: string;
  profileId: string;
  sidebarOpen: boolean;
  workOpen: boolean;
  workWidth: number;
  splitEnabled?: boolean;
  splitRatio?: number;
  primaryTabId?: string;
  secondaryTabId?: string;
  focusedPane?: "primary" | "secondary";
}

export interface StoredCredential {
  id: string;
  origin: string;
  username: string;
  encryptedPassword: Uint8Array;
  updatedAt?: number;
}

export interface StoredCredentialMetadata {
  id: string;
  origin: string;
  username: string;
  updatedAt: number;
}

export interface StoredBookmark {
  id: string;
  title: string;
  url: string;
  createdAt: number;
  updatedAt: number;
}

export interface StoredHistoryEntry {
  id: string;
  title: string;
  url: string;
  visitedAt: number;
}

export interface StoredDownload {
  id: string;
  tabId?: string;
  filename: string;
  url: string;
  path: string;
  state: "progressing" | "completed" | "cancelled" | "interrupted";
  receivedBytes: number;
  totalBytes: number;
  agentInitiated: boolean;
  startedAt: number;
  finishedAt?: number;
}

export interface StoredProfile {
  id: string;
  name: string;
  partitionName: string;
  createdAt: number;
}

export interface StoredTabGroup {
  id: string;
  windowId: string;
  profileId: string;
  name: string;
  color: string;
  collapsed: boolean;
  position: number;
}

export interface StoredSitePermission {
  origin: string;
  permission: string;
  decision: "allow" | "deny";
  updatedAt: number;
}

export interface StoredExtensionInstall {
  id: string;
  runtimeId?: string;
  name: string;
  version: string;
  enabled: boolean;
  source: "gallery" | "developer";
  installPath?: string;
  manifestJson: string;
  lastError?: string;
  updatedAt?: number;
}

export interface StoredExtensionPackage {
  extensionId: string;
  version: string;
  installPath: string;
  packageFingerprint: string;
  publisherFingerprint: string;
  galleryFingerprint: string;
  installedAt: number;
}

export type BrowserSyncCollection = "bookmarks" | "history" | "tab-groups" | "remote-tabs" | "settings" | "extensions";

export interface StoredSyncAccount {
  profileId: string;
  serviceUrl: string;
  accountId: string;
  deviceId: string;
  devicePublicKey: string;
  encryptedDevicePrivateKey: Uint8Array;
  encryptedDeviceToken: Uint8Array;
  encryptedAccountKey: Uint8Array;
  keyVersion: number;
  status: "connected" | "syncing" | "error";
  lastSyncedAt?: number;
  lastError?: string;
}

export interface SyncQueueRecord {
  collection: BrowserSyncCollection;
  recordId: string;
  clock: string;
  tombstone: boolean;
  value: unknown;
}

export interface StoredRemoteTab {
  id: string;
  deviceId: string;
  title: string;
  url: string;
  groupId?: string;
  updatedAt: number;
}

export interface StoredWalrusMemoryReceipt {
  jobId: string;
  blobId?: string;
  namespace: string;
  status: "pending" | "running" | "uploaded" | "done" | "failed" | "not_found" | "timeout";
  createdAt: number;
  updatedAt: number;
}

export interface StoredResearchBundleReceipt {
  id: string;
  boardId: string;
  quiltId: string;
  manifestSha256: string;
  visibility: "public" | "seal-encrypted";
  network: "mainnet" | "testnet";
  epochs: number;
  signerAddress: string;
  filesJson: string;
  createdAt: number;
}

export interface StoredRecordingSession {
  id: string;
  profileId: string;
  workSessionId: string;
  startedAt: number;
  endedAt?: number;
  status: "recording" | "completed" | "interrupted";
  engine: string;
  sourcesJson: string;
  saveVideo: boolean;
  videoPath?: string;
}

export interface StoredRecordingSegment {
  id: string;
  recordingId: string;
  source: "tab" | "microphone";
  startMs: number;
  endMs: number;
  tabId?: string;
  nonce: string;
  ciphertext: string;
}

export class BrowserDatabase {
  readonly #database: DatabaseSyncType;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.#database = new DatabaseSync(path);
    this.#database.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
    this.#migrate();
  }

  close(): void {
    this.#database.close();
  }

  listProfiles(): StoredProfile[] {
    return this.#database.prepare(`
      SELECT id, name, partition_name AS partitionName, created_at AS createdAt
      FROM browser_profiles ORDER BY created_at ASC, name COLLATE NOCASE ASC
    `).all() as unknown as StoredProfile[];
  }

  profile(id: string): StoredProfile | undefined {
    return this.#database.prepare(`
      SELECT id, name, partition_name AS partitionName, created_at AS createdAt
      FROM browser_profiles WHERE id = ?
    `).get(id) as unknown as StoredProfile | undefined;
  }

  createProfile(name: string): StoredProfile {
    const id = randomDatabaseId();
    const partitionName = `persist:locus-profile-${id}`;
    this.#database.prepare(`
      INSERT INTO browser_profiles(id, name, partition_name, created_at)
      VALUES (?, ?, ?, unixepoch())
    `).run(id, name.trim(), partitionName);
    return this.profile(id)!;
  }

  renameProfile(id: string, name: string): void {
    this.#database.prepare("UPDATE browser_profiles SET name = ? WHERE id = ?").run(name.trim(), id);
  }

  deleteProfile(id: string): void {
    if (id === "default") throw new Error("The default profile cannot be deleted");
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      for (const table of [
        "history_visits", "bookmarks", "downloads", "site_permissions", "browser_settings",
        "browser_credentials", "recording_sessions", "recording_keys", "extension_packages", "extension_installs", "sync_local_records", "sync_outbox", "sync_inbox", "walrus_memory_receipts", "research_bundle_receipts",
      ]) {
        this.#database.prepare(`DELETE FROM ${table} WHERE profile_id = ?`).run(id);
      }
      this.#database.prepare("DELETE FROM browser_windows WHERE profile_id = ?").run(id);
      this.#database.prepare("DELETE FROM browser_profiles WHERE id = ?").run(id);
      this.#database.exec("COMMIT");
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  loadWindow(id: string): StoredWindow | undefined {
    return this.#database.prepare(`
      SELECT id, profile_id AS profileId, sidebar_open AS sidebarOpen,
             work_open AS workOpen, work_width AS workWidth,
             split_enabled AS splitEnabled, split_ratio AS splitRatio,
             primary_tab_id AS primaryTabId, secondary_tab_id AS secondaryTabId,
             focused_pane AS focusedPane
      FROM browser_windows WHERE id = ?
    `).get(id) as unknown as StoredWindow | undefined;
  }

  loadTabs(windowId: string): StoredTab[] {
    return this.#database.prepare(`
      SELECT id, window_id AS windowId, profile_id AS profileId, position,
             url, title, active, muted, pinned, private, group_id AS groupId
      FROM browser_tabs WHERE window_id = ? ORDER BY position ASC
    `).all(windowId) as unknown as StoredTab[];
  }

  loadTabGroups(windowId: string): StoredTabGroup[] {
    return this.#database.prepare(`
      SELECT id, window_id AS windowId, profile_id AS profileId, name, color,
             collapsed, position
      FROM tab_groups WHERE window_id = ? ORDER BY position ASC
    `).all(windowId) as unknown as StoredTabGroup[];
  }

  saveWindow(window: StoredWindow, tabs: StoredTab[], groups: StoredTabGroup[] = []): void {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      this.#database.prepare(`
        INSERT INTO browser_windows(
          id, profile_id, sidebar_open, work_open, work_width,
          split_enabled, split_ratio, primary_tab_id, secondary_tab_id, focused_pane, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
        ON CONFLICT(id) DO UPDATE SET
          profile_id = excluded.profile_id,
          sidebar_open = excluded.sidebar_open,
          work_open = excluded.work_open,
          work_width = excluded.work_width,
          split_enabled = excluded.split_enabled,
          split_ratio = excluded.split_ratio,
          primary_tab_id = excluded.primary_tab_id,
          secondary_tab_id = excluded.secondary_tab_id,
          focused_pane = excluded.focused_pane,
          updated_at = excluded.updated_at
      `).run(
        window.id,
        window.profileId,
        Number(window.sidebarOpen),
        Number(window.workOpen),
        window.workWidth,
        Number(Boolean(window.splitEnabled)),
        window.splitRatio ?? 0.5,
        window.primaryTabId ?? null,
        window.secondaryTabId ?? null,
        window.focusedPane ?? "primary",
      );

      const upsert = this.#database.prepare(`
        INSERT INTO browser_tabs(
          id, window_id, profile_id, position, url, title, active,
          muted, pinned, private, group_id, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
        ON CONFLICT(id) DO UPDATE SET
          position = excluded.position,
          url = excluded.url,
          title = excluded.title,
          active = excluded.active,
          muted = excluded.muted,
          pinned = excluded.pinned,
          group_id = excluded.group_id,
          updated_at = excluded.updated_at
      `);
      const ids: string[] = [];
      for (const tab of tabs) {
        ids.push(tab.id);
        upsert.run(
          tab.id,
          tab.windowId,
          tab.profileId,
          tab.position,
          tab.url,
          tab.title,
          Number(tab.active),
          Number(tab.muted),
          Number(tab.pinned),
          Number(tab.private),
          tab.groupId ?? null,
        );
      }
      const upsertGroup = this.#database.prepare(`
        INSERT INTO tab_groups(id, window_id, profile_id, name, color, collapsed, position, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch())
        ON CONFLICT(id) DO UPDATE SET
          name=excluded.name, color=excluded.color, collapsed=excluded.collapsed,
          position=excluded.position, updated_at=excluded.updated_at
      `);
      const groupIds: string[] = [];
      for (const group of groups) {
        groupIds.push(group.id);
        upsertGroup.run(group.id, group.windowId, group.profileId, group.name, group.color, Number(group.collapsed), group.position);
      }
      if (groupIds.length === 0) {
        this.#database.prepare("DELETE FROM tab_groups WHERE window_id = ?").run(window.id);
      } else {
        const placeholders = groupIds.map(() => "?").join(",");
        this.#database.prepare(`DELETE FROM tab_groups WHERE window_id = ? AND id NOT IN (${placeholders})`).run(window.id, ...groupIds);
      }
      if (ids.length === 0) {
        this.#database.prepare("DELETE FROM browser_tabs WHERE window_id = ?").run(window.id);
      } else {
        const placeholders = ids.map(() => "?").join(",");
        this.#database.prepare(
          `DELETE FROM browser_tabs WHERE window_id = ? AND id NOT IN (${placeholders})`,
        ).run(window.id, ...ids);
      }
      this.#database.exec("COMMIT");
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  recordVisit(profileId: string, tabId: string, url: string, title: string): void {
    if (!url.startsWith("http://") && !url.startsWith("https://")) return;
    this.#database.prepare(`
      INSERT INTO history_visits(id, profile_id, tab_id, url, title, visited_at)
      VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, unixepoch())
    `).run(profileId, tabId, url, title);
  }

  recordingKey(profileId: string): Uint8Array | undefined {
    const row = this.#database.prepare("SELECT wrapped_key AS wrappedKey FROM recording_keys WHERE profile_id = ?")
      .get(profileId) as unknown as { wrappedKey: Uint8Array } | undefined;
    return row?.wrappedKey;
  }

  saveRecordingKey(profileId: string, wrappedKey: Uint8Array): void {
    this.#database.prepare(`
      INSERT INTO recording_keys(profile_id, wrapped_key, updated_at) VALUES (?, ?, unixepoch())
      ON CONFLICT(profile_id) DO UPDATE SET wrapped_key=excluded.wrapped_key, updated_at=excluded.updated_at
    `).run(profileId, wrappedKey);
  }

  createRecordingSession(session: StoredRecordingSession): void {
    this.#database.prepare(`
      INSERT INTO recording_sessions(
        id, profile_id, work_session_id, started_at, ended_at, status,
        engine, sources_json, save_video, video_path
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      session.id, session.profileId, session.workSessionId, session.startedAt,
      session.endedAt ?? null, session.status, session.engine, session.sourcesJson,
      Number(session.saveVideo), session.videoPath ?? null,
    );
  }

  finishRecordingSession(id: string, status: "completed" | "interrupted", endedAt: number, videoPath?: string): void {
    this.#database.prepare(`
      UPDATE recording_sessions SET status=?, ended_at=?, video_path=? WHERE id=?
    `).run(status, endedAt, videoPath ?? null, id);
  }

  saveRecordingSegment(segment: StoredRecordingSegment): void {
    this.#database.prepare(`
      INSERT INTO recording_segments(
        id, recording_id, source, start_ms, end_ms, tab_id, nonce, ciphertext, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
    `).run(
      segment.id, segment.recordingId, segment.source, segment.startMs, segment.endMs,
      segment.tabId ?? null, segment.nonce, segment.ciphertext,
    );
  }

  listRecordingSessions(profileId: string, limit = 100): StoredRecordingSession[] {
    return this.#database.prepare(`
      SELECT id, profile_id AS profileId, work_session_id AS workSessionId,
             started_at AS startedAt, ended_at AS endedAt, status, engine,
             sources_json AS sourcesJson, save_video AS saveVideo, video_path AS videoPath
      FROM recording_sessions WHERE profile_id=? ORDER BY started_at DESC LIMIT ?
    `).all(profileId, Math.max(1, Math.min(limit, 500))) as unknown as StoredRecordingSession[];
  }

  recordingSegments(recordingId: string): StoredRecordingSegment[] {
    return this.#database.prepare(`
      SELECT id, recording_id AS recordingId, source, start_ms AS startMs, end_ms AS endMs,
             tab_id AS tabId, nonce, ciphertext
      FROM recording_segments WHERE recording_id=? ORDER BY start_ms ASC, id ASC
    `).all(recordingId) as unknown as StoredRecordingSegment[];
  }

  deleteRecording(profileId: string, recordingId: string): void {
    this.#database.prepare("DELETE FROM recording_sessions WHERE profile_id=? AND id=?").run(profileId, recordingId);
  }

  listHistory(profileId: string, limit = 250): StoredHistoryEntry[] {
    return this.#database.prepare(`
      SELECT id, title, url, visited_at AS visitedAt
      FROM history_visits WHERE profile_id = ? ORDER BY visited_at DESC LIMIT ?
    `).all(profileId, Math.max(1, Math.min(limit, 2_000))) as unknown as StoredHistoryEntry[];
  }

  listBookmarks(profileId: string): StoredBookmark[] {
    return this.#database.prepare(`
      SELECT id, title, url, created_at AS createdAt, updated_at AS updatedAt
      FROM bookmarks WHERE profile_id = ? AND url IS NOT NULL AND tombstoned_at IS NULL
      ORDER BY position ASC, updated_at DESC
    `).all(profileId) as unknown as StoredBookmark[];
  }

  bookmarkForUrl(profileId: string, url: string): StoredBookmark | undefined {
    return this.#database.prepare(`
      SELECT id, title, url, created_at AS createdAt, updated_at AS updatedAt
      FROM bookmarks WHERE profile_id = ? AND url = ? AND tombstoned_at IS NULL LIMIT 1
    `).get(profileId, url) as unknown as StoredBookmark | undefined;
  }

  addBookmark(profileId: string, title: string, url: string): string {
    const id = randomDatabaseId();
    const position = Date.now().toString().padStart(20, "0");
    this.#database.prepare(`
      INSERT INTO bookmarks(id, profile_id, position, title, url, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, unixepoch(), unixepoch())
    `).run(id, profileId, position, title || url, url);
    return id;
  }

  removeBookmark(profileId: string, id: string): void {
    this.#database.prepare("UPDATE bookmarks SET tombstoned_at = unixepoch(), updated_at = unixepoch() WHERE profile_id = ? AND id = ?").run(profileId, id);
  }

  saveDownload(profileId: string, download: StoredDownload): void {
    this.#database.prepare(`
      INSERT INTO downloads(
        id, profile_id, tab_id, filename, url, path, state, received_bytes, total_bytes,
        agent_initiated, started_at, finished_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        filename=excluded.filename, path=excluded.path, state=excluded.state,
        received_bytes=excluded.received_bytes, total_bytes=excluded.total_bytes,
        finished_at=excluded.finished_at
    `).run(
      download.id,
      profileId,
      download.tabId ?? null,
      download.filename,
      download.url,
      download.path,
      download.state,
      download.receivedBytes,
      download.totalBytes,
      Number(download.agentInitiated),
      download.startedAt,
      download.finishedAt ?? null,
    );
  }

  listDownloads(profileId: string, limit = 100): StoredDownload[] {
    return this.#database.prepare(`
      SELECT id, tab_id AS tabId, filename, url, path, state,
             received_bytes AS receivedBytes, total_bytes AS totalBytes,
             agent_initiated AS agentInitiated, started_at AS startedAt,
             finished_at AS finishedAt
      FROM downloads WHERE profile_id = ? ORDER BY started_at DESC LIMIT ?
    `).all(profileId, Math.max(1, Math.min(limit, 1_000))) as unknown as StoredDownload[];
  }

  sitePermission(profileId: string, origin: string, permission: string): "allow" | "deny" | undefined {
    const row = this.#database.prepare(`
      SELECT decision FROM site_permissions WHERE profile_id = ? AND origin = ? AND permission = ?
    `).get(profileId, origin, permission) as unknown as { decision: "allow" | "deny" } | undefined;
    return row?.decision;
  }

  listSitePermissions(profileId: string): StoredSitePermission[] {
    return this.#database.prepare(`
      SELECT origin, permission, decision, updated_at AS updatedAt
      FROM site_permissions WHERE profile_id = ? ORDER BY updated_at DESC, origin ASC
    `).all(profileId) as unknown as StoredSitePermission[];
  }

  setSitePermission(profileId: string, origin: string, permission: string, decision: "allow" | "deny"): void {
    this.#database.prepare(`
      INSERT INTO site_permissions(profile_id, origin, permission, decision, updated_at)
      VALUES (?, ?, ?, ?, unixepoch())
      ON CONFLICT(profile_id, origin, permission) DO UPDATE SET
        decision=excluded.decision, updated_at=excluded.updated_at
    `).run(profileId, origin, permission, decision);
  }

  removeSitePermission(profileId: string, origin: string, permission: string): void {
    this.#database.prepare("DELETE FROM site_permissions WHERE profile_id = ? AND origin = ? AND permission = ?").run(profileId, origin, permission);
  }

  setting(profileId: string, key: string): unknown {
    const row = this.#database.prepare(`
      SELECT value_json AS valueJson FROM browser_settings WHERE profile_id = ? AND key = ?
    `).get(profileId, key) as unknown as { valueJson: string } | undefined;
    if (!row) return undefined;
    try { return JSON.parse(row.valueJson); } catch { return undefined; }
  }

  setSetting(profileId: string, key: string, value: unknown): void {
    this.#database.prepare(`
      INSERT INTO browser_settings(profile_id, key, value_json, updated_at)
      VALUES (?, ?, ?, unixepoch())
      ON CONFLICT(profile_id, key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at
    `).run(profileId, key, JSON.stringify(value));
  }

  deleteSetting(profileId: string, key: string): void {
    this.#database.prepare("DELETE FROM browser_settings WHERE profile_id = ? AND key = ?").run(profileId, key);
  }

  saveWalrusMemoryReceipt(profileId: string, receipt: StoredWalrusMemoryReceipt): void {
    this.#database.prepare(`
      INSERT INTO walrus_memory_receipts(profile_id, job_id, blob_id, namespace, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(profile_id, job_id) DO UPDATE SET
        blob_id=excluded.blob_id, namespace=excluded.namespace, status=excluded.status, updated_at=excluded.updated_at
    `).run(profileId, receipt.jobId, receipt.blobId ?? null, receipt.namespace, receipt.status, receipt.createdAt, receipt.updatedAt);
  }

  listWalrusMemoryReceipts(profileId: string): StoredWalrusMemoryReceipt[] {
    return this.#database.prepare(`
      SELECT job_id AS jobId, blob_id AS blobId, namespace, status,
             created_at AS createdAt, updated_at AS updatedAt
      FROM walrus_memory_receipts WHERE profile_id = ? ORDER BY updated_at DESC LIMIT 200
    `).all(profileId) as unknown as StoredWalrusMemoryReceipt[];
  }

  saveResearchBundleReceipt(profileId: string, receipt: StoredResearchBundleReceipt): void {
    this.#database.prepare(`
      INSERT INTO research_bundle_receipts(
        profile_id, id, board_id, quilt_id, manifest_sha256, visibility, network,
        epochs, signer_address, files_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(profile_id, id) DO UPDATE SET
        quilt_id=excluded.quilt_id, manifest_sha256=excluded.manifest_sha256,
        signer_address=excluded.signer_address, files_json=excluded.files_json
    `).run(
      profileId, receipt.id, receipt.boardId, receipt.quiltId, receipt.manifestSha256,
      receipt.visibility, receipt.network, receipt.epochs, receipt.signerAddress,
      receipt.filesJson, receipt.createdAt,
    );
  }

  listResearchBundleReceipts(profileId: string): StoredResearchBundleReceipt[] {
    return this.#database.prepare(`
      SELECT id, board_id AS boardId, quilt_id AS quiltId, manifest_sha256 AS manifestSha256,
             visibility, network, epochs, signer_address AS signerAddress,
             files_json AS filesJson, created_at AS createdAt
      FROM research_bundle_receipts WHERE profile_id = ? ORDER BY created_at DESC LIMIT 200
    `).all(profileId) as unknown as StoredResearchBundleReceipt[];
  }

  listExtensionInstalls(profileId: string): StoredExtensionInstall[] {
    const rows = this.#database.prepare(`
      SELECT extension_id AS id, runtime_id AS runtimeId, name, version, enabled, source,
             install_path AS installPath, manifest_json AS manifestJson,
             last_error AS lastError, updated_at AS updatedAt
      FROM extension_installs WHERE profile_id = ? ORDER BY name COLLATE NOCASE ASC, extension_id ASC
    `).all(profileId) as unknown as Array<Omit<StoredExtensionInstall, "enabled" | "source"> & { enabled: number; source: string }>;
    return rows.flatMap((row) => row.source === "gallery" || row.source === "developer"
      ? [{ ...row, enabled: Boolean(row.enabled), source: row.source }]
      : []);
  }

  saveExtensionInstall(profileId: string, install: StoredExtensionInstall): void {
    this.#database.prepare(`
      INSERT INTO extension_installs(
        profile_id, extension_id, runtime_id, name, version, enabled, source,
        install_path, manifest_json, last_error, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
      ON CONFLICT(profile_id, extension_id) DO UPDATE SET
        runtime_id=excluded.runtime_id, name=excluded.name, version=excluded.version,
        enabled=excluded.enabled, source=excluded.source, install_path=excluded.install_path,
        manifest_json=excluded.manifest_json, last_error=excluded.last_error, updated_at=excluded.updated_at
    `).run(
      profileId,
      install.id,
      install.runtimeId ?? null,
      install.name,
      install.version,
      Number(install.enabled),
      install.source,
      install.installPath ?? null,
      install.manifestJson,
      install.lastError ?? null,
    );
  }

  setExtensionLoadState(profileId: string, id: string, enabled: boolean, runtimeId?: string, lastError?: string): void {
    this.#database.prepare(`
      UPDATE extension_installs SET enabled=?, runtime_id=COALESCE(?, runtime_id),
        last_error=?, updated_at=unixepoch() WHERE profile_id=? AND extension_id=?
    `).run(Number(enabled), runtimeId ?? null, lastError ?? null, profileId, id);
  }

  deleteExtensionInstall(profileId: string, id: string): void {
    this.#database.prepare("DELETE FROM extension_installs WHERE profile_id=? AND extension_id=?").run(profileId, id);
  }

  listExtensionPackages(profileId: string, extensionId: string): StoredExtensionPackage[] {
    return this.#database.prepare(`
      SELECT extension_id AS extensionId, version, install_path AS installPath,
             package_fingerprint AS packageFingerprint,
             publisher_fingerprint AS publisherFingerprint,
             gallery_fingerprint AS galleryFingerprint, installed_at AS installedAt
      FROM extension_packages WHERE profile_id=? AND extension_id=?
      ORDER BY installed_at DESC, version DESC
    `).all(profileId, extensionId) as unknown as StoredExtensionPackage[];
  }

  saveExtensionPackage(profileId: string, extensionPackage: StoredExtensionPackage): void {
    this.#database.prepare(`
      INSERT INTO extension_packages(
        profile_id, extension_id, version, install_path, package_fingerprint,
        publisher_fingerprint, gallery_fingerprint, installed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(profile_id, extension_id, package_fingerprint) DO UPDATE SET
        version=excluded.version, install_path=excluded.install_path,
        publisher_fingerprint=excluded.publisher_fingerprint,
        gallery_fingerprint=excluded.gallery_fingerprint
    `).run(
      profileId,
      extensionPackage.extensionId,
      extensionPackage.version,
      extensionPackage.installPath,
      extensionPackage.packageFingerprint,
      extensionPackage.publisherFingerprint,
      extensionPackage.galleryFingerprint,
      extensionPackage.installedAt,
    );
  }

  deleteExtensionPackages(profileId: string, extensionId: string): void {
    this.#database.prepare("DELETE FROM extension_packages WHERE profile_id=? AND extension_id=?").run(profileId, extensionId);
  }

  saveCredential(profileId: string, credential: StoredCredential): void {
    this.#database.prepare(`
      INSERT INTO browser_credentials(id, profile_id, origin, username, encrypted_password, updated_at)
      VALUES (?, ?, ?, ?, ?, unixepoch())
      ON CONFLICT(id) DO UPDATE SET
        profile_id=excluded.profile_id, origin=excluded.origin, username=excluded.username,
        encrypted_password=excluded.encrypted_password, updated_at=excluded.updated_at
    `).run(credential.id, profileId, credential.origin, credential.username, credential.encryptedPassword);
  }

  credentialsForOrigin(profileId: string, origin: string): StoredCredential[] {
    return this.#database.prepare(`
      SELECT id, origin, username, encrypted_password AS encryptedPassword, updated_at AS updatedAt
      FROM browser_credentials WHERE profile_id = ? AND origin = ? ORDER BY updated_at DESC
    `).all(profileId, origin) as unknown as StoredCredential[];
  }

  listCredentials(profileId: string): StoredCredentialMetadata[] {
    return this.#database.prepare(`
      SELECT id, origin, username, updated_at AS updatedAt
      FROM browser_credentials WHERE profile_id = ? ORDER BY updated_at DESC, origin ASC
    `).all(profileId) as unknown as StoredCredentialMetadata[];
  }

  deleteCredential(profileId: string, id: string): void {
    this.#database.prepare("DELETE FROM browser_credentials WHERE profile_id = ? AND id = ?").run(profileId, id);
  }

  syncAccount(profileId: string): StoredSyncAccount | undefined {
    return this.#database.prepare(`
      SELECT profile_id AS profileId, service_url AS serviceUrl, account_id AS accountId,
             device_id AS deviceId, device_public_key AS devicePublicKey,
             encrypted_device_private_key AS encryptedDevicePrivateKey,
             encrypted_device_token AS encryptedDeviceToken,
             encrypted_account_key AS encryptedAccountKey, key_version AS keyVersion, status,
             last_synced_at AS lastSyncedAt, last_error AS lastError
      FROM sync_accounts WHERE profile_id = ?
    `).get(profileId) as unknown as StoredSyncAccount | undefined;
  }

  saveSyncAccount(account: StoredSyncAccount): void {
    this.#database.prepare(`
      INSERT INTO sync_accounts(
        profile_id, service_url, account_id, device_id, device_public_key,
        encrypted_device_private_key, encrypted_device_token, encrypted_account_key,
        key_version, status, last_synced_at, last_error, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
      ON CONFLICT(profile_id) DO UPDATE SET
        service_url=excluded.service_url, account_id=excluded.account_id,
        device_id=excluded.device_id, device_public_key=excluded.device_public_key,
        encrypted_device_private_key=excluded.encrypted_device_private_key,
        encrypted_device_token=excluded.encrypted_device_token,
        encrypted_account_key=excluded.encrypted_account_key,
        key_version=excluded.key_version,
        status=excluded.status, last_synced_at=excluded.last_synced_at,
        last_error=excluded.last_error, updated_at=excluded.updated_at
    `).run(
      account.profileId,
      account.serviceUrl,
      account.accountId,
      account.deviceId,
      account.devicePublicKey,
      account.encryptedDevicePrivateKey,
      account.encryptedDeviceToken,
      account.encryptedAccountKey,
      account.keyVersion,
      account.status,
      account.lastSyncedAt ?? null,
      account.lastError ?? null,
    );
  }

  updateSyncAccountStatus(profileId: string, status: StoredSyncAccount["status"], lastError?: string, synced = false): void {
    this.#database.prepare(`
      UPDATE sync_accounts SET status=?, last_error=?,
        last_synced_at=CASE WHEN ? THEN unixepoch() ELSE last_synced_at END,
        updated_at=unixepoch() WHERE profile_id=?
    `).run(status, lastError ?? null, Number(synced), profileId);
  }

  updateSyncAccountKey(profileId: string, encryptedAccountKey: Uint8Array, keyVersion: number): void {
    this.#database.prepare(`
      UPDATE sync_accounts SET encrypted_account_key=?, key_version=?, last_error=NULL,
        status='connected', updated_at=unixepoch() WHERE profile_id=?
    `).run(encryptedAccountKey, keyVersion, profileId);
  }

  deleteSyncAccount(profileId: string): void {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      for (const table of ["sync_accounts", "sync_local_records", "sync_outbox", "sync_inbox", "sync_profiles"]) {
        this.#database.prepare(`DELETE FROM ${table} WHERE profile_id = ?`).run(profileId);
      }
      this.#database.exec("COMMIT");
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  resetSyncData(profileId: string): void {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      for (const table of ["sync_local_records", "sync_outbox", "sync_inbox", "sync_profiles"]) {
        this.#database.prepare(`DELETE FROM ${table} WHERE profile_id = ?`).run(profileId);
      }
      this.#database.exec("COMMIT");
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  queueSyncSnapshot(profileId: string, deviceId: string, nextClock: () => string): number {
    const records = this.#syncSnapshot(profileId, deviceId);
    const seen = new Set(records.map((record) => `${record.collection}:${record.recordId}`));
    let queued = 0;
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const shadow = this.#database.prepare(`
        SELECT fingerprint, clock, tombstone FROM sync_local_records
        WHERE profile_id=? AND collection=? AND record_id=?
      `);
      const upsertShadow = this.#database.prepare(`
        INSERT INTO sync_local_records(profile_id, collection, record_id, fingerprint, clock, tombstone, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, unixepoch())
        ON CONFLICT(profile_id, collection, record_id) DO UPDATE SET
          fingerprint=excluded.fingerprint, clock=excluded.clock,
          tombstone=excluded.tombstone, updated_at=excluded.updated_at
      `);
      const upsertOutbox = this.#database.prepare(`
        INSERT INTO sync_outbox(profile_id, collection, record_id, clock, tombstone, payload_json, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, unixepoch())
        ON CONFLICT(profile_id, collection, record_id) DO UPDATE SET
          clock=excluded.clock, tombstone=excluded.tombstone,
          payload_json=excluded.payload_json, updated_at=excluded.updated_at
      `);
      for (const record of records) {
        const payloadJson = JSON.stringify(record.value);
        const fingerprint = syncFingerprint(payloadJson, record.tombstone);
        const existing = shadow.get(profileId, record.collection, record.recordId) as unknown as { fingerprint: string; tombstone: number } | undefined;
        if (existing?.fingerprint === fingerprint && Boolean(existing.tombstone) === record.tombstone) continue;
        const clock = nextClock();
        upsertShadow.run(profileId, record.collection, record.recordId, fingerprint, clock, Number(record.tombstone));
        upsertOutbox.run(profileId, record.collection, record.recordId, clock, Number(record.tombstone), payloadJson);
        queued += 1;
      }
      const localRecords = this.#database.prepare(`
        SELECT collection, record_id AS recordId, tombstone FROM sync_local_records WHERE profile_id=?
      `).all(profileId) as unknown as Array<{ collection: BrowserSyncCollection; recordId: string; tombstone: number }>;
      for (const existing of localRecords) {
        if (existing.collection === "history" || existing.tombstone) continue;
        if (existing.collection === "remote-tabs" && !existing.recordId.startsWith(`${deviceId}:`)) continue;
        if (seen.has(`${existing.collection}:${existing.recordId}`)) continue;
        const clock = nextClock();
        const payloadJson = JSON.stringify({ deleted: true });
        upsertShadow.run(profileId, existing.collection, existing.recordId, syncFingerprint(payloadJson, true), clock, 1);
        upsertOutbox.run(profileId, existing.collection, existing.recordId, clock, 1, payloadJson);
        queued += 1;
      }
      this.#database.exec("COMMIT");
      return queued;
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  syncOutbox(profileId: string, limit = 500): SyncQueueRecord[] {
    const rows = this.#database.prepare(`
      SELECT collection, record_id AS recordId, clock, tombstone, payload_json AS payloadJson
      FROM sync_outbox WHERE profile_id=? ORDER BY updated_at ASC LIMIT ?
    `).all(profileId, Math.max(1, Math.min(limit, 500))) as unknown as Array<Omit<SyncQueueRecord, "value" | "tombstone"> & { tombstone: number; payloadJson: string }>;
    return rows.map(({ payloadJson, tombstone, ...row }) => ({ ...row, tombstone: Boolean(tombstone), value: JSON.parse(payloadJson) }));
  }

  syncOutboxCount(profileId: string): number {
    const row = this.#database.prepare("SELECT count(*) AS count FROM sync_outbox WHERE profile_id=?").get(profileId) as unknown as { count: number };
    return row.count;
  }

  clearSyncOutbox(profileId: string, records: SyncQueueRecord[]): void {
    const remove = this.#database.prepare(`
      DELETE FROM sync_outbox WHERE profile_id=? AND collection=? AND record_id=? AND clock=?
    `);
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      for (const record of records) remove.run(profileId, record.collection, record.recordId, record.clock);
      this.#database.exec("COMMIT");
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  syncProgress(profileId: string): { cursor: number; lastClock?: string } {
    const row = this.#database.prepare(`
      SELECT cursor, last_clock AS lastClock FROM sync_profiles WHERE profile_id=?
    `).get(profileId) as unknown as { cursor: number; lastClock?: string } | undefined;
    return row ?? { cursor: 0 };
  }

  setSyncProgress(profileId: string, cursor: number, lastClock?: string): void {
    this.#database.prepare(`
      INSERT INTO sync_profiles(profile_id, cursor, last_clock, updated_at)
      VALUES (?, ?, ?, unixepoch())
      ON CONFLICT(profile_id) DO UPDATE SET cursor=excluded.cursor,
        last_clock=COALESCE(excluded.last_clock, sync_profiles.last_clock), updated_at=excluded.updated_at
    `).run(profileId, cursor, lastClock ?? null);
  }

  applyPulledSyncRecord(profileId: string, record: SyncQueueRecord & { deviceId: string }): boolean {
    const existingInbox = this.#database.prepare(`
      SELECT clock FROM sync_inbox WHERE profile_id=? AND collection=? AND record_id=?
    `).get(profileId, record.collection, record.recordId) as unknown as { clock: string } | undefined;
    if (existingInbox && existingInbox.clock >= record.clock) return false;
    const payloadJson = JSON.stringify(record.value);
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      this.#database.prepare(`
        INSERT INTO sync_inbox(profile_id, collection, record_id, device_id, clock, tombstone, payload_json, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch())
        ON CONFLICT(profile_id, collection, record_id) DO UPDATE SET
          device_id=excluded.device_id, clock=excluded.clock, tombstone=excluded.tombstone,
          payload_json=excluded.payload_json, updated_at=excluded.updated_at
      `).run(profileId, record.collection, record.recordId, record.deviceId, record.clock, Number(record.tombstone), payloadJson);
      const appliedLocally = this.#applyPulledBrowserValue(profileId, record);
      if (appliedLocally) {
        this.#database.prepare(`
          INSERT INTO sync_local_records(profile_id, collection, record_id, fingerprint, clock, tombstone, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, unixepoch())
          ON CONFLICT(profile_id, collection, record_id) DO UPDATE SET
            fingerprint=excluded.fingerprint, clock=excluded.clock,
            tombstone=excluded.tombstone, updated_at=excluded.updated_at
          WHERE sync_local_records.clock < excluded.clock
        `).run(profileId, record.collection, record.recordId, syncFingerprint(payloadJson, record.tombstone), record.clock, Number(record.tombstone));
      }
      this.#database.exec("COMMIT");
      return true;
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  listRemoteTabs(profileId: string, localDeviceId: string): StoredRemoteTab[] {
    const rows = this.#database.prepare(`
      SELECT record_id AS id, device_id AS deviceId, payload_json AS payloadJson, updated_at AS updatedAt
      FROM sync_inbox WHERE profile_id=? AND collection='remote-tabs' AND tombstone=0 AND device_id<>?
      ORDER BY updated_at DESC
    `).all(profileId, localDeviceId) as unknown as Array<{ id: string; deviceId: string; payloadJson: string; updatedAt: number }>;
    return rows.flatMap((row) => {
      try {
        const value = JSON.parse(row.payloadJson) as { title?: unknown; url?: unknown; groupId?: unknown };
        if (typeof value.title !== "string" || typeof value.url !== "string") return [];
        return [{ id: row.id, deviceId: row.deviceId, title: value.title, url: value.url, ...(typeof value.groupId === "string" ? { groupId: value.groupId } : {}), updatedAt: row.updatedAt }];
      } catch { return []; }
    });
  }

  cleanupExpiredSyncTombstones(profileId: string, nowSeconds = Math.floor(Date.now() / 1_000)): void {
    const cutoff = nowSeconds - 90 * 24 * 60 * 60;
    this.#database.prepare("DELETE FROM sync_inbox WHERE profile_id=? AND tombstone=1 AND updated_at<?").run(profileId, cutoff);
    this.#database.prepare("DELETE FROM sync_local_records WHERE profile_id=? AND tombstone=1 AND updated_at<?").run(profileId, cutoff);
    this.#database.prepare("DELETE FROM bookmarks WHERE profile_id=? AND tombstoned_at IS NOT NULL AND tombstoned_at<?").run(profileId, cutoff);
  }

  #syncSnapshot(profileId: string, deviceId: string): Array<{ collection: BrowserSyncCollection; recordId: string; tombstone: boolean; value: unknown }> {
    const result: Array<{ collection: BrowserSyncCollection; recordId: string; tombstone: boolean; value: unknown }> = [];
    const bookmarks = this.#database.prepare(`
      SELECT id, position, title, url, created_at AS createdAt, updated_at AS updatedAt, tombstoned_at AS tombstonedAt
      FROM bookmarks WHERE profile_id=?
    `).all(profileId) as unknown as Array<{ id: string; position: string; title: string; url?: string; createdAt: number; updatedAt: number; tombstonedAt?: number }>;
    for (const item of bookmarks) result.push({
      collection: "bookmarks", recordId: item.id, tombstone: Boolean(item.tombstonedAt),
      value: { position: item.position, title: item.title, url: item.url ?? null, createdAt: item.createdAt, updatedAt: item.updatedAt },
    });
    const history = this.#database.prepare(`
      SELECT id, title, url, visited_at AS visitedAt FROM history_visits WHERE profile_id=?
    `).all(profileId) as unknown as StoredHistoryEntry[];
    for (const item of history) result.push({ collection: "history", recordId: item.id, tombstone: false, value: item });
    const groups = this.#database.prepare(`
      SELECT id, name, color, collapsed, position, updated_at AS updatedAt FROM tab_groups WHERE profile_id=?
    `).all(profileId) as unknown as Array<{ id: string; name: string; color: string; collapsed: number; position: number; updatedAt: number }>;
    for (const item of groups) result.push({ collection: "tab-groups", recordId: item.id, tombstone: false, value: { ...item, collapsed: Boolean(item.collapsed), deviceId } });
    const tabs = this.#database.prepare(`
      SELECT id, title, url, group_id AS groupId, updated_at AS updatedAt
      FROM browser_tabs WHERE profile_id=? AND private=0 AND (url LIKE 'https://%' OR url LIKE 'http://%')
    `).all(profileId) as unknown as Array<{ id: string; title: string; url: string; groupId?: string; updatedAt: number }>;
    for (const item of tabs) result.push({ collection: "remote-tabs", recordId: `${deviceId}:${item.id}`, tombstone: false, value: { ...item, deviceId } });
    const settings = this.#database.prepare(`
      SELECT key, value_json AS valueJson FROM browser_settings
      WHERE profile_id=? AND key IN ('appearance','searchEngine','sleepAfterMinutes')
    `).all(profileId) as unknown as Array<{ key: string; valueJson: string }>;
    for (const item of settings) result.push({ collection: "settings", recordId: item.key, tombstone: false, value: JSON.parse(item.valueJson) });
    const extensions = this.#database.prepare(`
      SELECT extension_id AS id, version, enabled, source FROM extension_installs
      WHERE profile_id=? AND source='gallery'
    `).all(profileId) as unknown as Array<{ id: string; version: string; enabled: number; source: string }>;
    for (const item of extensions) result.push({ collection: "extensions", recordId: item.id, tombstone: false, value: { ...item, enabled: Boolean(item.enabled) } });
    return result;
  }

  #applyPulledBrowserValue(profileId: string, record: SyncQueueRecord): boolean {
    const shadow = this.#database.prepare(`
      SELECT clock FROM sync_local_records WHERE profile_id=? AND collection=? AND record_id=?
    `).get(profileId, record.collection, record.recordId) as unknown as { clock: string } | undefined;
    if (shadow && shadow.clock >= record.clock) return false;
    if (record.collection === "bookmarks") {
      if (record.tombstone) {
        this.#database.prepare("UPDATE bookmarks SET tombstoned_at=unixepoch(), updated_at=unixepoch() WHERE profile_id=? AND id=?").run(profileId, record.recordId);
      } else {
        const value = record.value as { position?: unknown; title?: unknown; url?: unknown; createdAt?: unknown; updatedAt?: unknown };
        if (typeof value.position !== "string" || typeof value.title !== "string" || typeof value.url !== "string") return false;
        this.#database.prepare(`
          INSERT INTO bookmarks(id, profile_id, position, title, url, created_at, updated_at, tombstoned_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
          ON CONFLICT(id) DO UPDATE SET profile_id=excluded.profile_id, position=excluded.position,
            title=excluded.title, url=excluded.url, updated_at=excluded.updated_at, tombstoned_at=NULL
        `).run(record.recordId, profileId, value.position, value.title, value.url, Number(value.createdAt) || Math.floor(Date.now() / 1_000), Number(value.updatedAt) || Math.floor(Date.now() / 1_000));
      }
      return true;
    }
    if (record.collection === "history" && !record.tombstone) {
      const value = record.value as { title?: unknown; url?: unknown; visitedAt?: unknown };
      if (typeof value.title !== "string" || typeof value.url !== "string" || typeof value.visitedAt !== "number") return false;
      this.#database.prepare(`
        INSERT OR IGNORE INTO history_visits(id, profile_id, tab_id, url, title, visited_at)
        VALUES (?, ?, NULL, ?, ?, ?)
      `).run(record.recordId, profileId, value.url, value.title, value.visitedAt);
      return true;
    }
    if (record.collection === "settings" && !record.tombstone && ["appearance", "searchEngine", "sleepAfterMinutes"].includes(record.recordId)) {
      this.setSetting(profileId, record.recordId, record.value);
      return true;
    }
    if (record.collection === "extensions") {
      if (record.tombstone) {
        this.#database.prepare("DELETE FROM extension_installs WHERE profile_id=? AND extension_id=? AND source='gallery'").run(profileId, record.recordId);
      } else {
        const value = record.value as { version?: unknown; enabled?: unknown; source?: unknown };
        if (typeof value.version !== "string" || typeof value.enabled !== "boolean" || value.source !== "gallery") return false;
        this.#database.prepare(`
          INSERT INTO extension_installs(profile_id, extension_id, version, enabled, source, manifest_json, updated_at)
          VALUES (?, ?, ?, ?, ?, '{}', unixepoch())
          ON CONFLICT(profile_id, extension_id) DO UPDATE SET
            version=CASE WHEN extension_installs.install_path IS NULL THEN excluded.version ELSE extension_installs.version END,
            enabled=excluded.enabled, source=excluded.source, updated_at=excluded.updated_at
          WHERE extension_installs.source='gallery'
        `).run(profileId, record.recordId, value.version, Number(value.enabled), value.source);
      }
      return true;
    }
    return false;
  }

  #migrate(): void {
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS browser_profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        partition_name TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE TABLE IF NOT EXISTS browser_windows (
        id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL,
        sidebar_open INTEGER NOT NULL DEFAULT 0,
        work_open INTEGER NOT NULL DEFAULT 0,
        work_width REAL NOT NULL DEFAULT 420,
        split_enabled INTEGER NOT NULL DEFAULT 0,
        split_ratio REAL NOT NULL DEFAULT 0.5,
        primary_tab_id TEXT,
        secondary_tab_id TEXT,
        focused_pane TEXT NOT NULL DEFAULT 'primary',
        updated_at INTEGER NOT NULL,
        FOREIGN KEY(profile_id) REFERENCES browser_profiles(id)
      );
      CREATE TABLE IF NOT EXISTS browser_tabs (
        id TEXT PRIMARY KEY,
        window_id TEXT NOT NULL,
        profile_id TEXT NOT NULL,
        position INTEGER NOT NULL,
        url TEXT NOT NULL,
        title TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 0,
        muted INTEGER NOT NULL DEFAULT 0,
        pinned INTEGER NOT NULL DEFAULT 0,
        private INTEGER NOT NULL DEFAULT 0,
        group_id TEXT,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY(window_id) REFERENCES browser_windows(id) ON DELETE CASCADE,
        FOREIGN KEY(profile_id) REFERENCES browser_profiles(id)
      );
      CREATE TABLE IF NOT EXISTS tab_groups (
        id TEXT PRIMARY KEY,
        window_id TEXT NOT NULL,
        profile_id TEXT NOT NULL,
        name TEXT NOT NULL,
        color TEXT NOT NULL DEFAULT 'lime',
        collapsed INTEGER NOT NULL DEFAULT 0,
        position INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY(window_id) REFERENCES browser_windows(id) ON DELETE CASCADE,
        FOREIGN KEY(profile_id) REFERENCES browser_profiles(id)
      );
      CREATE TABLE IF NOT EXISTS history_visits (
        id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL DEFAULT 'default',
        tab_id TEXT,
        url TEXT NOT NULL,
        title TEXT NOT NULL,
        visited_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS history_visits_time ON history_visits(visited_at DESC);
      CREATE TABLE IF NOT EXISTS bookmarks (
        id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL DEFAULT 'default',
        parent_id TEXT,
        position TEXT NOT NULL,
        title TEXT NOT NULL,
        url TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL,
        tombstoned_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS downloads (
        id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL DEFAULT 'default',
        tab_id TEXT,
        filename TEXT NOT NULL DEFAULT '',
        url TEXT NOT NULL,
        path TEXT NOT NULL,
        state TEXT NOT NULL,
        received_bytes INTEGER NOT NULL DEFAULT 0,
        total_bytes INTEGER NOT NULL DEFAULT 0,
        agent_initiated INTEGER NOT NULL DEFAULT 0,
        started_at INTEGER NOT NULL,
        finished_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS site_permissions (
        profile_id TEXT NOT NULL,
        origin TEXT NOT NULL,
        permission TEXT NOT NULL,
        decision TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY(profile_id, origin, permission)
      );
      CREATE TABLE IF NOT EXISTS browser_credentials (
        id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL DEFAULT 'default',
        origin TEXT NOT NULL,
        username TEXT NOT NULL,
        encrypted_password BLOB NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS browser_credentials_origin ON browser_credentials(origin);
      CREATE TABLE IF NOT EXISTS recording_keys (
        profile_id TEXT PRIMARY KEY,
        wrapped_key BLOB NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY(profile_id) REFERENCES browser_profiles(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS recording_sessions (
        id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL,
        work_session_id TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        status TEXT NOT NULL,
        engine TEXT NOT NULL,
        sources_json TEXT NOT NULL,
        save_video INTEGER NOT NULL DEFAULT 0,
        video_path TEXT,
        FOREIGN KEY(profile_id) REFERENCES browser_profiles(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS recording_segments (
        id TEXT PRIMARY KEY,
        recording_id TEXT NOT NULL,
        source TEXT NOT NULL,
        start_ms INTEGER NOT NULL,
        end_ms INTEGER NOT NULL,
        tab_id TEXT,
        nonce TEXT NOT NULL,
        ciphertext TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY(recording_id) REFERENCES recording_sessions(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS recording_sessions_profile_time ON recording_sessions(profile_id, started_at DESC);
      CREATE INDEX IF NOT EXISTS recording_segments_recording_time ON recording_segments(recording_id, start_ms ASC);
      CREATE TABLE IF NOT EXISTS browser_settings (
        profile_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY(profile_id, key),
        FOREIGN KEY(profile_id) REFERENCES browser_profiles(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS walrus_memory_receipts (
        profile_id TEXT NOT NULL,
        job_id TEXT NOT NULL,
        blob_id TEXT,
        namespace TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY(profile_id, job_id),
        FOREIGN KEY(profile_id) REFERENCES browser_profiles(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS walrus_memory_receipts_profile_time ON walrus_memory_receipts(profile_id, updated_at DESC);
      CREATE TABLE IF NOT EXISTS research_bundle_receipts (
        profile_id TEXT NOT NULL,
        id TEXT NOT NULL,
        board_id TEXT NOT NULL,
        quilt_id TEXT NOT NULL,
        manifest_sha256 TEXT NOT NULL,
        visibility TEXT NOT NULL,
        network TEXT NOT NULL,
        epochs INTEGER NOT NULL,
        signer_address TEXT NOT NULL,
        files_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY(profile_id, id),
        FOREIGN KEY(profile_id) REFERENCES browser_profiles(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS research_bundle_receipts_profile_time ON research_bundle_receipts(profile_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS extension_installs (
        profile_id TEXT NOT NULL,
        extension_id TEXT NOT NULL,
        version TEXT NOT NULL,
        enabled INTEGER NOT NULL,
        source TEXT NOT NULL,
        manifest_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY(profile_id, extension_id)
      );
      CREATE TABLE IF NOT EXISTS extension_packages (
        profile_id TEXT NOT NULL,
        extension_id TEXT NOT NULL,
        version TEXT NOT NULL,
        install_path TEXT NOT NULL,
        package_fingerprint TEXT NOT NULL,
        publisher_fingerprint TEXT NOT NULL,
        gallery_fingerprint TEXT NOT NULL,
        installed_at INTEGER NOT NULL,
        PRIMARY KEY(profile_id, extension_id, package_fingerprint),
        FOREIGN KEY(profile_id, extension_id) REFERENCES extension_installs(profile_id, extension_id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS sync_state (
        collection TEXT PRIMARY KEY,
        cursor TEXT,
        clock TEXT,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sync_accounts (
        profile_id TEXT PRIMARY KEY,
        service_url TEXT NOT NULL,
        account_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        device_public_key TEXT NOT NULL,
        encrypted_device_private_key BLOB NOT NULL,
        encrypted_device_token BLOB NOT NULL,
        encrypted_account_key BLOB NOT NULL,
        key_version INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL,
        last_synced_at INTEGER,
        last_error TEXT,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY(profile_id) REFERENCES browser_profiles(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS sync_profiles (
        profile_id TEXT PRIMARY KEY,
        cursor INTEGER NOT NULL DEFAULT 0,
        last_clock TEXT,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY(profile_id) REFERENCES browser_profiles(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS sync_local_records (
        profile_id TEXT NOT NULL,
        collection TEXT NOT NULL,
        record_id TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        clock TEXT NOT NULL,
        tombstone INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY(profile_id, collection, record_id)
      );
      CREATE TABLE IF NOT EXISTS sync_outbox (
        profile_id TEXT NOT NULL,
        collection TEXT NOT NULL,
        record_id TEXT NOT NULL,
        clock TEXT NOT NULL,
        tombstone INTEGER NOT NULL DEFAULT 0,
        payload_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY(profile_id, collection, record_id)
      );
      CREATE TABLE IF NOT EXISTS sync_inbox (
        profile_id TEXT NOT NULL,
        collection TEXT NOT NULL,
        record_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        clock TEXT NOT NULL,
        tombstone INTEGER NOT NULL DEFAULT 0,
        payload_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY(profile_id, collection, record_id)
      );
      INSERT OR IGNORE INTO browser_profiles(id, name, partition_name)
      VALUES ('default', 'Personal', 'persist:locus-profile-default');
      INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (1, unixepoch());
    `);
    this.#ensureColumn("bookmarks", "created_at", "INTEGER NOT NULL DEFAULT 0");
    this.#ensureColumn("downloads", "filename", "TEXT NOT NULL DEFAULT ''");
    this.#ensureColumn("downloads", "received_bytes", "INTEGER NOT NULL DEFAULT 0");
    this.#ensureColumn("downloads", "total_bytes", "INTEGER NOT NULL DEFAULT 0");
    this.#ensureColumn("browser_tabs", "group_id", "TEXT");
    this.#ensureColumn("browser_windows", "split_enabled", "INTEGER NOT NULL DEFAULT 0");
    this.#ensureColumn("browser_windows", "split_ratio", "REAL NOT NULL DEFAULT 0.5");
    this.#ensureColumn("browser_windows", "primary_tab_id", "TEXT");
    this.#ensureColumn("browser_windows", "secondary_tab_id", "TEXT");
    this.#ensureColumn("browser_windows", "focused_pane", "TEXT NOT NULL DEFAULT 'primary'");
    this.#ensureColumn("history_visits", "profile_id", "TEXT NOT NULL DEFAULT 'default'");
    this.#ensureColumn("bookmarks", "profile_id", "TEXT NOT NULL DEFAULT 'default'");
    this.#ensureColumn("downloads", "profile_id", "TEXT NOT NULL DEFAULT 'default'");
    this.#ensureColumn("browser_credentials", "profile_id", "TEXT NOT NULL DEFAULT 'default'");
    this.#ensureColumn("sync_accounts", "key_version", "INTEGER NOT NULL DEFAULT 1");
    this.#ensureColumn("extension_installs", "runtime_id", "TEXT");
    this.#ensureColumn("extension_installs", "name", "TEXT NOT NULL DEFAULT ''");
    this.#ensureColumn("extension_installs", "install_path", "TEXT");
    this.#ensureColumn("extension_installs", "last_error", "TEXT");
    this.#database.exec(`
      CREATE INDEX IF NOT EXISTS history_visits_profile_time ON history_visits(profile_id, visited_at DESC);
      CREATE INDEX IF NOT EXISTS bookmarks_profile_position ON bookmarks(profile_id, position ASC);
      CREATE INDEX IF NOT EXISTS downloads_profile_time ON downloads(profile_id, started_at DESC);
      CREATE INDEX IF NOT EXISTS browser_credentials_profile_origin ON browser_credentials(profile_id, origin);
      INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (2, unixepoch());
      INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (3, unixepoch());
      INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (4, unixepoch());
      INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (5, unixepoch());
      INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (6, unixepoch());
      INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (7, unixepoch());
      INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (8, unixepoch());
      INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (9, unixepoch());
      INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (10, unixepoch());
      INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (11, unixepoch());
    `);
  }

  #ensureColumn(table: string, column: string, definition: string): void {
    const columns = this.#database.prepare(`PRAGMA table_info(${table})`).all() as unknown as Array<{ name: string }>;
    if (!columns.some((entry) => entry.name === column)) {
      this.#database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }
}

function randomDatabaseId(): string {
  return randomUUID();
}

function syncFingerprint(payloadJson: string, tombstone: boolean): string {
  return createHash("sha256").update(tombstone ? "1:" : "0:").update(payloadJson).digest("hex");
}
