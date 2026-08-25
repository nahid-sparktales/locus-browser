import { createHash, randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { decryptLocalValue, encryptLocalValue, type LocalEncryptedValue } from "@locus/sync-crypto";
import type {
  ResearchBoardState,
  ResearchBoardSummaryState,
  ResumeBundleState,
  SemanticRecallResultState,
  SemanticRecallState,
} from "../shared/types.js";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
const CAP_BYTES = 500 * 1024 * 1024;

interface ParentPort {
  on(event: "message", listener: (message: { data: unknown }) => void): void;
  postMessage(message: unknown): void;
}

interface RequestMessage { id: string; type: string; payload: Record<string, unknown> }
interface StoredDocument {
  id: string; profileId: string; url: string; canonicalUrl: string; title: string;
  visitedAt: number; bookmarked: number; sizeBytes: number; contentHash: string;
  nonce: string; ciphertext: string;
}

const parentPort = (process as unknown as { parentPort?: ParentPort }).parentPort;
if (!parentPort) throw new Error("Private intelligence must run as an Electron utility process");
const utilityPort = parentPort;

let database: DatabaseSyncType | undefined;
let profileId = "";
let encryptionKey = "";
let helper: SemanticHelper | undefined;
const cache = new Map<string, { text: string; vector: number[]; language: string; backend: string }>();

utilityPort.on("message", (event) => {
  void handle(event.data).catch((error) => {
    const request = event.data as Partial<RequestMessage>;
    utilityPort.postMessage({ id: request.id, ok: false, error: error instanceof Error ? error.message : "Private intelligence failed" });
  });
});

async function handle(raw: unknown): Promise<void> {
  if (!raw || typeof raw !== "object") return;
  const request = raw as RequestMessage;
  if (!request.id || typeof request.type !== "string" || !request.payload || typeof request.payload !== "object") return;
  let value: unknown;
  switch (request.type) {
    case "initialize": value = await initialize(request.payload); break;
    case "status": value = status(); break;
    case "index": value = await indexDocument(request.payload); break;
    case "search": value = await searchDocuments(String(request.payload.query || ""), Number(request.payload.limit) || 30); break;
    case "set-excluded": value = setExcluded(String(request.payload.origin || ""), Boolean(request.payload.excluded)); break;
    case "delete-document": value = deleteDocument(String(request.payload.id || "")); break;
    case "clear-recall": value = clearRecall(); break;
    case "save-board": value = await saveBoard(request.payload.board as ResearchBoardState); break;
    case "list-boards": value = await listBoards(); break;
    case "get-board": value = await getEncryptedRecord<ResearchBoardState>("research_boards", String(request.payload.id || ""), "board"); break;
    case "delete-board": value = deleteEncryptedRecord("research_boards", String(request.payload.id || "")); break;
    case "save-bundle": value = await saveBundle(request.payload); break;
    case "list-bundles": value = await listBundles(); break;
    case "get-bundle": value = await getEncryptedRecord("resume_bundles", String(request.payload.id || ""), "bundle"); break;
    case "delete-bundle": value = deleteEncryptedRecord("resume_bundles", String(request.payload.id || "")); break;
    default: throw new Error("Unknown private-intelligence request");
  }
  utilityPort.postMessage({ id: request.id, ok: true, value });
}

async function initialize(payload: Record<string, unknown>): Promise<SemanticRecallState> {
  const path = String(payload.databasePath || "");
  profileId = String(payload.profileId || "");
  encryptionKey = String(payload.key || "");
  if (!path || !profileId || !encryptionKey) throw new Error("Private-intelligence initialization is incomplete");
  mkdirSync(dirname(path), { recursive: true });
  database = new DatabaseSync(path);
  database.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
  migrate(database);
  helper = new SemanticHelper(String(payload.helperPath || ""));
  return status();
}

function requireDatabase(): DatabaseSyncType {
  if (!database) throw new Error("Private intelligence is not initialized");
  return database;
}

function status(): SemanticRecallState {
  const db = requireDatabase();
  const aggregate = db.prepare("SELECT count(*) AS documentCount, COALESCE(sum(size_bytes),0) AS storageBytes FROM recall_documents WHERE profile_id=?")
    .get(profileId) as unknown as { documentCount: number; storageBytes: number };
  const excluded = db.prepare("SELECT origin FROM recall_exclusions WHERE profile_id=? ORDER BY origin")
    .all(profileId) as unknown as Array<{ origin: string }>;
  return {
    enabled: true,
    status: aggregate.storageBytes >= CAP_BYTES ? "paused" : "ready",
    documentCount: aggregate.documentCount,
    storageBytes: aggregate.storageBytes,
    capBytes: CAP_BYTES,
    excludedOrigins: excluded.map((item) => item.origin),
    message: aggregate.storageBytes >= CAP_BYTES
      ? "Recall reached its storage cap. Remove saved content or unbookmark older pages to continue."
      : aggregate.documentCount ? "Private recall is ready." : "Recall is on. Eligible pages will be indexed after you visit them.",
  };
}

async function indexDocument(payload: Record<string, unknown>): Promise<{ indexed: boolean }> {
  const db = requireDatabase();
  const url = String(payload.url || "");
  const text = String(payload.text || "").trim().slice(0, 100_000);
  if (!/^https?:\/\//i.test(url) || text.length < 80) return { indexed: false };
  const origin = new URL(url).origin;
  if (db.prepare("SELECT 1 FROM recall_exclusions WHERE profile_id=? AND origin=?").get(profileId, origin)) return { indexed: false };
  const canonicalUrl = canonicalizeUrl(url);
  const id = createHash("sha256").update(`${profileId}:${canonicalUrl}`).digest("hex");
  const contentHash = createHash("sha256").update(text).digest("hex");
  const existing = db.prepare("SELECT content_hash AS contentHash FROM recall_documents WHERE id=? AND profile_id=?")
    .get(id, profileId) as unknown as { contentHash: string } | undefined;
  if (existing?.contentHash === contentHash) {
    db.prepare("UPDATE recall_documents SET visited_at=?, bookmarked=?, title=?, url=? WHERE id=? AND profile_id=?")
      .run(Math.max(0, Number(payload.visitedAt) || Date.now()), Number(Boolean(payload.bookmarked)), String(payload.title || url).slice(0, 2_048), url, id, profileId);
    return { indexed: false };
  }
  const embedded = await (helper?.embed(text, String(payload.language || "auto")) ?? Promise.resolve(keywordEmbedding(text)));
  const record = { text, vector: embedded.vector, language: embedded.language, backend: embedded.backend };
  const encrypted = await encryptLocalValue(encryptionKey, `recall:${profileId}:${id}`, JSON.stringify(record));
  const sizeBytes = Buffer.byteLength(text, "utf8") + Buffer.byteLength(encrypted.ciphertext, "utf8");
  db.prepare(`
    INSERT INTO recall_documents(id, profile_id, canonical_url, url, title, visited_at, bookmarked, size_bytes, content_hash, nonce, ciphertext, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
    ON CONFLICT(id) DO UPDATE SET url=excluded.url, title=excluded.title, visited_at=excluded.visited_at,
      bookmarked=excluded.bookmarked, size_bytes=excluded.size_bytes, content_hash=excluded.content_hash,
      nonce=excluded.nonce, ciphertext=excluded.ciphertext, updated_at=excluded.updated_at
  `).run(
    id, profileId, canonicalUrl, url, String(payload.title || url).slice(0, 2_048),
    Math.max(0, Number(payload.visitedAt) || Date.now()), Number(Boolean(payload.bookmarked)), sizeBytes,
    contentHash, encrypted.nonce, encrypted.ciphertext,
  );
  cache.set(id, record);
  enforceCap();
  return { indexed: true };
}

async function searchDocuments(query: string, rawLimit: number): Promise<SemanticRecallResultState[]> {
  const db = requireDatabase();
  const cleanQuery = query.trim().slice(0, 2_000);
  if (!cleanQuery) return [];
  const limit = Math.max(1, Math.min(rawLimit, 100));
  const queryEmbedding = await (helper?.embed(cleanQuery, "auto") ?? Promise.resolve(keywordEmbedding(cleanQuery)));
  const timeFloor = queryTimeFloor(cleanQuery);
  const rows = db.prepare(`
    SELECT id, profile_id AS profileId, url, canonical_url AS canonicalUrl, title, visited_at AS visitedAt,
      bookmarked, size_bytes AS sizeBytes, content_hash AS contentHash, nonce, ciphertext
    FROM recall_documents WHERE profile_id=? AND visited_at>=? ORDER BY visited_at DESC LIMIT 20000
  `).all(profileId, timeFloor) as unknown as StoredDocument[];
  const terms = searchTerms(cleanQuery);
  const scored: SemanticRecallResultState[] = [];
  for (const row of rows) {
    let record: { text: string; vector: number[]; language: string; backend: string } | undefined = cache.get(row.id);
    if (!record) {
      try {
        const value: LocalEncryptedValue = { version: 1, nonce: row.nonce, ciphertext: row.ciphertext };
        record = JSON.parse(await decryptLocalValue(encryptionKey, `recall:${profileId}:${row.id}`, value)) as {
          text: string; vector: number[]; language: string; backend: string;
        };
        if (!record || !Array.isArray(record.vector) || typeof record.text !== "string") continue;
        cache.set(row.id, record);
      } catch { continue; }
    }
    const semantic = cosine(queryEmbedding.vector, record.vector);
    const lexical = lexicalScore(`${row.title} ${row.url} ${record.text}`, terms);
    const recency = Math.max(0, 1 - (Date.now() - row.visitedAt) / (180 * 24 * 60 * 60 * 1000));
    const score = semantic * 0.66 + lexical * 0.28 + recency * 0.06;
    if (score < 0.08 && lexical === 0) continue;
    scored.push({
      id: row.id, title: row.title, url: row.url, visitedAt: row.visitedAt,
      snippet: snippet(record.text, terms), score,
      source: row.bookmarked ? "bookmark" : "history",
    });
  }
  return scored.sort((left, right) => right.score - left.score || right.visitedAt - left.visitedAt).slice(0, limit);
}

function setExcluded(rawOrigin: string, excluded: boolean): void {
  const db = requireDatabase();
  const origin = new URL(rawOrigin).origin;
  if (!origin.startsWith("http")) throw new Error("Only web origins can be excluded");
  if (excluded) {
    db.prepare("INSERT OR IGNORE INTO recall_exclusions(profile_id, origin, created_at) VALUES (?, ?, unixepoch())").run(profileId, origin);
    const rows = db.prepare("SELECT id FROM recall_documents WHERE profile_id=? AND url LIKE ?")
      .all(profileId, `${origin}/%`) as unknown as Array<{ id: string }>;
    db.prepare("DELETE FROM recall_documents WHERE profile_id=? AND url LIKE ?").run(profileId, `${origin}/%`);
    for (const row of rows) cache.delete(row.id);
  } else db.prepare("DELETE FROM recall_exclusions WHERE profile_id=? AND origin=?").run(profileId, origin);
}

function deleteDocument(id: string): void {
  requireDatabase().prepare("DELETE FROM recall_documents WHERE profile_id=? AND id=?").run(profileId, id);
  cache.delete(id);
}

function clearRecall(): void {
  requireDatabase().prepare("DELETE FROM recall_documents WHERE profile_id=?").run(profileId);
  cache.clear();
}

async function saveBoard(board: ResearchBoardState): Promise<void> {
  if (!board || typeof board.id !== "string") throw new Error("Research board is malformed");
  const db = requireDatabase();
  const encrypted = await encryptLocalValue(encryptionKey, `board:${profileId}:${board.id}`, JSON.stringify(board));
  db.prepare(`
    INSERT INTO research_boards(id, profile_id, created_at, updated_at, status, source_count, nonce, ciphertext)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at, status=excluded.status,
      source_count=excluded.source_count, nonce=excluded.nonce, ciphertext=excluded.ciphertext
  `).run(board.id, profileId, board.createdAt, board.updatedAt, board.status, board.sources.length, encrypted.nonce, encrypted.ciphertext);
}

async function listBoards(): Promise<ResearchBoardSummaryState[]> {
  const rows = requireDatabase().prepare(`
    SELECT id, created_at AS createdAt, updated_at AS updatedAt, status, source_count AS sourceCount, nonce, ciphertext
    FROM research_boards WHERE profile_id=? ORDER BY updated_at DESC LIMIT 200
  `).all(profileId) as unknown as Array<{ id: string; createdAt: number; updatedAt: number; status: ResearchBoardState["status"]; sourceCount: number; nonce: string; ciphertext: string }>;
  const output: ResearchBoardSummaryState[] = [];
  for (const row of rows) {
    try {
      const board = await decryptRecord<ResearchBoardState>("board", row.id, row.nonce, row.ciphertext);
      output.push({ id: row.id, title: board.title || "Untitled research", status: row.status, sourceCount: row.sourceCount, createdAt: row.createdAt, updatedAt: row.updatedAt });
    } catch { /* Damaged local records stay unavailable instead of leaking partial data. */ }
  }
  return output;
}

async function saveBundle(payload: Record<string, unknown>): Promise<void> {
  const id = String(payload.id || randomUUID());
  const tabs = Array.isArray(payload.tabs) ? payload.tabs.slice(0, 200).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const tab = item as { title?: unknown; url?: unknown };
    const url = String(tab.url || "");
    return /^https?:\/\//.test(url) ? [{ title: String(tab.title || url).slice(0, 2_048), url }] : [];
  }) : [];
  if (!tabs.length) throw new Error("A Resume Later bundle needs at least one web tab");
  const value = { id, name: String(payload.name || "Resume later").trim().slice(0, 120), createdAt: Number(payload.createdAt) || Date.now(), tabs };
  const encrypted = await encryptLocalValue(encryptionKey, `bundle:${profileId}:${id}`, JSON.stringify(value));
  requireDatabase().prepare(`
    INSERT INTO resume_bundles(id, profile_id, created_at, tab_count, nonce, ciphertext)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET tab_count=excluded.tab_count, nonce=excluded.nonce, ciphertext=excluded.ciphertext
  `).run(id, profileId, value.createdAt, tabs.length, encrypted.nonce, encrypted.ciphertext);
}

async function listBundles(): Promise<ResumeBundleState[]> {
  const rows = requireDatabase().prepare(`
    SELECT id, created_at AS createdAt, tab_count AS tabCount, nonce, ciphertext
    FROM resume_bundles WHERE profile_id=? ORDER BY created_at DESC LIMIT 200
  `).all(profileId) as unknown as Array<{ id: string; createdAt: number; tabCount: number; nonce: string; ciphertext: string }>;
  const result: ResumeBundleState[] = [];
  for (const row of rows) {
    try {
      const bundle = await decryptRecord<{ name: string }>("bundle", row.id, row.nonce, row.ciphertext);
      result.push({ id: row.id, name: bundle.name, tabCount: row.tabCount, createdAt: row.createdAt });
    } catch { /* Ignore unreadable local records. */ }
  }
  return result;
}

async function getEncryptedRecord<T>(table: "research_boards" | "resume_bundles", id: string, kind: "board" | "bundle"): Promise<T | undefined> {
  const row = requireDatabase().prepare(`SELECT nonce, ciphertext FROM ${table} WHERE profile_id=? AND id=?`)
    .get(profileId, id) as unknown as { nonce: string; ciphertext: string } | undefined;
  return row ? await decryptRecord<T>(kind, id, row.nonce, row.ciphertext) : undefined;
}

function deleteEncryptedRecord(table: "research_boards" | "resume_bundles", id: string): void {
  requireDatabase().prepare(`DELETE FROM ${table} WHERE profile_id=? AND id=?`).run(profileId, id);
}

async function decryptRecord<T>(kind: string, id: string, nonce: string, ciphertext: string): Promise<T> {
  return JSON.parse(await decryptLocalValue(encryptionKey, `${kind}:${profileId}:${id}`, { version: 1, nonce, ciphertext })) as T;
}

function enforceCap(): void {
  const db = requireDatabase();
  let aggregate = db.prepare("SELECT COALESCE(sum(size_bytes),0) AS size FROM recall_documents WHERE profile_id=?").get(profileId) as unknown as { size: number };
  if (aggregate.size <= CAP_BYTES) return;
  const candidates = db.prepare("SELECT id, size_bytes AS sizeBytes FROM recall_documents WHERE profile_id=? AND bookmarked=0 ORDER BY visited_at ASC")
    .all(profileId) as unknown as Array<{ id: string; sizeBytes: number }>;
  for (const candidate of candidates) {
    if (aggregate.size <= CAP_BYTES) break;
    db.prepare("DELETE FROM recall_documents WHERE id=? AND profile_id=?").run(candidate.id, profileId);
    cache.delete(candidate.id);
    aggregate = { size: aggregate.size - candidate.sizeBytes };
  }
}

function migrate(db: DatabaseSyncType): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS recall_documents (
      id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, canonical_url TEXT NOT NULL, url TEXT NOT NULL,
      title TEXT NOT NULL, visited_at INTEGER NOT NULL, bookmarked INTEGER NOT NULL DEFAULT 0,
      size_bytes INTEGER NOT NULL, content_hash TEXT NOT NULL, nonce TEXT NOT NULL, ciphertext TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS recall_documents_profile_time ON recall_documents(profile_id, visited_at DESC);
    CREATE TABLE IF NOT EXISTS recall_exclusions (
      profile_id TEXT NOT NULL, origin TEXT NOT NULL, created_at INTEGER NOT NULL,
      PRIMARY KEY(profile_id, origin)
    );
    CREATE TABLE IF NOT EXISTS research_boards (
      id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      status TEXT NOT NULL, source_count INTEGER NOT NULL, nonce TEXT NOT NULL, ciphertext TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS research_boards_profile_time ON research_boards(profile_id, updated_at DESC);
    CREATE TABLE IF NOT EXISTS resume_bundles (
      id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, created_at INTEGER NOT NULL, tab_count INTEGER NOT NULL,
      nonce TEXT NOT NULL, ciphertext TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS resume_bundles_profile_time ON resume_bundles(profile_id, created_at DESC);
  `);
}

class SemanticHelper {
  #process: ChildProcessWithoutNullStreams | undefined;
  #buffer = "";
  #pending = new Map<string, { resolve(value: { language: string; backend: string; vector: number[] }): void; reject(error: Error): void; timeout: NodeJS.Timeout }>();

  constructor(path: string) {
    if (!path) return;
    try {
      const process = spawn(path, [], { stdio: ["pipe", "pipe", "pipe"] });
      this.#process = process;
      process.stdout.setEncoding("utf8");
      process.stdout.on("data", (chunk: string) => this.#accept(chunk));
      process.once("exit", () => this.#failAll(new Error("Semantic helper stopped")));
      process.stderr.resume();
    } catch { this.#process = undefined; }
  }

  async embed(text: string, language: string): Promise<{ language: string; backend: string; vector: number[] }> {
    const process = this.#process;
    if (!process || process.exitCode !== null) return keywordEmbedding(text);
    const id = randomUUID();
    return await new Promise<{ language: string; backend: string; vector: number[] }>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(id);
        resolve(keywordEmbedding(text));
      }, 10_000);
      this.#pending.set(id, { resolve, reject, timeout });
      process.stdin.write(`${JSON.stringify({ id, text: text.slice(0, 64_000), language })}\n`);
    }).catch(() => keywordEmbedding(text));
  }

  #accept(chunk: string): void {
    this.#buffer += chunk;
    for (;;) {
      const newline = this.#buffer.indexOf("\n");
      if (newline < 0) return;
      const line = this.#buffer.slice(0, newline);
      this.#buffer = this.#buffer.slice(newline + 1);
      try {
        const response = JSON.parse(line) as { id?: string; embedding?: { language?: string; backend?: string; vector?: unknown }; error?: string };
        const pending = response.id ? this.#pending.get(response.id) : undefined;
        if (!pending) continue;
        clearTimeout(pending.timeout);
        this.#pending.delete(response.id!);
        const vector = response.embedding?.vector;
        if (response.error || !Array.isArray(vector) || !vector.every((value) => typeof value === "number" && Number.isFinite(value))) {
          pending.reject(new Error(response.error || "Semantic helper returned an invalid vector"));
        } else pending.resolve({ language: String(response.embedding?.language || "und"), backend: String(response.embedding?.backend || "apple-natural-language"), vector });
      } catch { /* Ignore malformed helper output. */ }
    }
  }

  #failAll(error: Error): void {
    this.#process = undefined;
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.#pending.clear();
  }
}

function keywordEmbedding(text: string): { language: string; backend: string; vector: number[] } {
  const vector = Array.from({ length: 256 }, () => 0);
  for (const word of searchTerms(text)) {
    const digest = createHash("sha256").update(word).digest();
    const index = digest.readUInt16BE(0) % vector.length;
    vector[index] = (vector[index] ?? 0) + 1;
  }
  const magnitude = Math.sqrt(vector.reduce((total, value) => total + value * value, 0));
  return { language: "und", backend: "keyword", vector: magnitude ? vector.map((value) => value / magnitude) : vector };
}

function cosine(left: number[], right: number[]): number {
  if (!left.length || left.length !== right.length) return 0;
  let dot = 0; let leftMagnitude = 0; let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index]! * right[index]!;
    leftMagnitude += left[index]! ** 2;
    rightMagnitude += right[index]! ** 2;
  }
  return leftMagnitude && rightMagnitude ? dot / Math.sqrt(leftMagnitude * rightMagnitude) : 0;
}

function searchTerms(value: string): string[] {
  return [...new Set(value.toLocaleLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [])].slice(0, 40);
}

function lexicalScore(haystack: string, terms: string[]): number {
  if (!terms.length) return 0;
  const lower = haystack.toLocaleLowerCase();
  return terms.filter((term) => lower.includes(term)).length / terms.length;
}

function snippet(text: string, terms: string[]): string {
  const lower = text.toLocaleLowerCase();
  const positions = terms.map((term) => lower.indexOf(term)).filter((position) => position >= 0);
  const center = positions.length ? Math.min(...positions) : 0;
  const start = Math.max(0, center - 110);
  const value = text.slice(start, start + 360).replace(/\s+/g, " ").trim();
  return `${start ? "…" : ""}${value}${start + 360 < text.length ? "…" : ""}`;
}

function queryTimeFloor(query: string): number {
  const lower = query.toLowerCase();
  const day = 24 * 60 * 60 * 1000;
  if (/today|this morning/.test(lower)) return Date.now() - day;
  if (/yesterday/.test(lower)) return Date.now() - day * 2;
  if (/last week|past week|this week/.test(lower)) return Date.now() - day * 8;
  if (/last month|past month|this month/.test(lower)) return Date.now() - day * 32;
  return 0;
}

function canonicalizeUrl(raw: string): string {
  const url = new URL(raw);
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$)/i.test(key)) url.searchParams.delete(key);
  }
  url.hostname = url.hostname.toLowerCase();
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString();
}
