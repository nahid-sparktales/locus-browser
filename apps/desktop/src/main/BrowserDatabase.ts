import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
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
}

export interface StoredCredential {
  id: string;
  origin: string;
  username: string;
  encryptedPassword: Uint8Array;
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
      for (const table of ["history_visits", "bookmarks", "downloads", "site_permissions", "browser_settings", "extension_installs"]) {
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
             work_open AS workOpen, work_width AS workWidth
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
        INSERT INTO browser_windows(id, profile_id, sidebar_open, work_open, work_width, updated_at)
        VALUES (?, ?, ?, ?, ?, unixepoch())
        ON CONFLICT(id) DO UPDATE SET
          profile_id = excluded.profile_id,
          sidebar_open = excluded.sidebar_open,
          work_open = excluded.work_open,
          work_width = excluded.work_width,
          updated_at = excluded.updated_at
      `).run(
        window.id,
        window.profileId,
        Number(window.sidebarOpen),
        Number(window.workOpen),
        window.workWidth,
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

  saveCredential(credential: StoredCredential): void {
    this.#database.prepare(`
      INSERT INTO browser_credentials(id, origin, username, encrypted_password, updated_at)
      VALUES (?, ?, ?, ?, unixepoch())
      ON CONFLICT(id) DO UPDATE SET
        origin=excluded.origin, username=excluded.username,
        encrypted_password=excluded.encrypted_password, updated_at=excluded.updated_at
    `).run(credential.id, credential.origin, credential.username, credential.encryptedPassword);
  }

  credentialsForOrigin(origin: string): StoredCredential[] {
    return this.#database.prepare(`
      SELECT id, origin, username, encrypted_password AS encryptedPassword
      FROM browser_credentials WHERE origin = ? ORDER BY updated_at DESC
    `).all(origin) as unknown as StoredCredential[];
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
        origin TEXT NOT NULL,
        username TEXT NOT NULL,
        encrypted_password BLOB NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS browser_credentials_origin ON browser_credentials(origin);
      CREATE TABLE IF NOT EXISTS browser_settings (
        profile_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY(profile_id, key),
        FOREIGN KEY(profile_id) REFERENCES browser_profiles(id) ON DELETE CASCADE
      );
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
      CREATE TABLE IF NOT EXISTS sync_state (
        collection TEXT PRIMARY KEY,
        cursor TEXT,
        clock TEXT,
        updated_at INTEGER NOT NULL
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
    this.#ensureColumn("history_visits", "profile_id", "TEXT NOT NULL DEFAULT 'default'");
    this.#ensureColumn("bookmarks", "profile_id", "TEXT NOT NULL DEFAULT 'default'");
    this.#ensureColumn("downloads", "profile_id", "TEXT NOT NULL DEFAULT 'default'");
    this.#database.exec(`
      CREATE INDEX IF NOT EXISTS history_visits_profile_time ON history_visits(profile_id, visited_at DESC);
      CREATE INDEX IF NOT EXISTS bookmarks_profile_position ON bookmarks(profile_id, position ASC);
      CREATE INDEX IF NOT EXISTS downloads_profile_time ON downloads(profile_id, started_at DESC);
      INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (2, unixepoch());
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
