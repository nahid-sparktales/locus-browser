import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { utilityProcess, type UtilityProcess } from "electron";
import type {
  ResearchBoardState,
  ResearchBoardSummaryState,
  ResumeBundleState,
  SemanticRecallResultState,
  SemanticRecallState,
} from "../shared/types.js";
import type { BrowserDatabase } from "./BrowserDatabase.js";
import type { CredentialCipher } from "./CredentialVault.js";
import type {
  WalrusBundlePublishInput,
  WalrusBundlePublishResult,
  WalrusManualConfiguration,
  WalrusManualConfigurationResult,
} from "../shared/walrusPrivate.js";

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timeout: NodeJS.Timeout;
}

interface UtilityResponse {
  id?: string;
  ok?: boolean;
  value?: unknown;
  error?: string;
  type?: string;
  status?: SemanticRecallState;
}

const CONTENT_KEY_SETTING = "localContentKeyV1";
const DEFAULT_STATUS: SemanticRecallState = {
  enabled: false,
  status: "starting",
  documentCount: 0,
  storageBytes: 0,
  capBytes: 500 * 1024 * 1024,
  excludedOrigins: [],
  message: "Starting private intelligence…",
};

export class LocalIntelligenceClient {
  #process: UtilityProcess | undefined;
  #pending = new Map<string, PendingRequest>();
  #status: SemanticRecallState = { ...DEFAULT_STATUS };
  #boards: ResearchBoardSummaryState[] = [];
  #bundles: ResumeBundleState[] = [];
  #ready: Promise<void>;
  #disposed = false;

  constructor(
    readonly database: BrowserDatabase,
    readonly cipher: CredentialCipher,
    readonly profileId: string,
    readonly dataRoot: string,
    readonly platformRoot: string,
    readonly enabled: () => boolean,
    readonly onChanged: () => void,
  ) {
    this.#ready = this.#start();
  }

  status(): SemanticRecallState {
    return { ...this.#status, enabled: this.enabled(), status: this.enabled() ? this.#status.status : "disabled" };
  }

  boards(): ResearchBoardSummaryState[] { return this.#boards.map((board) => ({ ...board })); }
  bundles(): ResumeBundleState[] { return this.#bundles.map((bundle) => ({ ...bundle })); }

  async refresh(): Promise<void> {
    await this.#ready;
    const [status, boards, bundles] = await Promise.all([
      this.#request("status", {}), this.#request("list-boards", {}), this.#request("list-bundles", {}),
    ]);
    this.#status = parseStatus(status, this.enabled());
    this.#boards = Array.isArray(boards) ? boards as ResearchBoardSummaryState[] : [];
    this.#bundles = Array.isArray(bundles) ? bundles as ResumeBundleState[] : [];
    this.onChanged();
  }

  async index(value: {
    url: string; title: string; text: string; visitedAt: number; bookmarked: boolean; language?: string;
  }): Promise<void> {
    if (!this.enabled()) return;
    await this.#ready;
    this.#status = { ...this.#status, enabled: true, status: "indexing", message: "Privately indexing this page…" };
    this.onChanged();
    await this.#request("index", value);
    await this.refresh();
  }

  async search(query: string, limit = 30): Promise<SemanticRecallResultState[]> {
    if (!this.enabled()) return [];
    await this.#ready;
    const value = await this.#request("search", { query, limit });
    return Array.isArray(value) ? value as SemanticRecallResultState[] : [];
  }

  async setExcluded(origin: string, excluded: boolean): Promise<void> {
    await this.#ready;
    await this.#request("set-excluded", { origin, excluded });
    await this.refresh();
  }

  async deleteDocument(id: string): Promise<void> {
    await this.#ready;
    await this.#request("delete-document", { id });
    await this.refresh();
  }

  async clearRecall(): Promise<void> {
    await this.#ready;
    await this.#request("clear-recall", {});
    await this.refresh();
  }

  async saveBoard(board: ResearchBoardState): Promise<void> {
    await this.#ready;
    await this.#request("save-board", { board });
    await this.refresh();
  }

  async board(id: string): Promise<ResearchBoardState | undefined> {
    await this.#ready;
    return await this.#request("get-board", { id }) as ResearchBoardState | undefined;
  }

  async deleteBoard(id: string): Promise<void> {
    await this.#ready;
    await this.#request("delete-board", { id });
    await this.refresh();
  }

  async saveBundle(value: { name: string; tabs: Array<{ title: string; url: string }> }): Promise<string> {
    await this.#ready;
    const id = randomUUID();
    await this.#request("save-bundle", { id, createdAt: Date.now(), ...value });
    await this.refresh();
    return id;
  }

  async bundle(id: string): Promise<{ id: string; name: string; createdAt: number; tabs: Array<{ title: string; url: string }> } | undefined> {
    await this.#ready;
    return await this.#request("get-bundle", { id }) as { id: string; name: string; createdAt: number; tabs: Array<{ title: string; url: string }> } | undefined;
  }

  async deleteBundle(id: string): Promise<void> {
    await this.#ready;
    await this.#request("delete-bundle", { id });
    await this.refresh();
  }

  async configureWalrusManual(config: WalrusManualConfiguration): Promise<WalrusManualConfigurationResult> {
    await this.#ready;
    return await this.#request("walrus-manual-configure", { config }) as WalrusManualConfigurationResult;
  }

  async disconnectWalrusManual(): Promise<void> {
    await this.#ready;
    await this.#request("walrus-manual-disconnect", {});
  }

  async walrusManualRemember(text: string, namespace: string): Promise<{ id: string; blob_id: string; namespace: string }> {
    await this.#ready;
    return await this.#request("walrus-manual-remember", { text, namespace }) as { id: string; blob_id: string; namespace: string };
  }

  async walrusManualRecall(query: string, limit: number, namespace: string): Promise<{
    results: Array<{ blob_id: string; text: string; distance: number }>;
  }> {
    await this.#ready;
    return await this.#request("walrus-manual-recall", { query, limit, namespace }) as {
      results: Array<{ blob_id: string; text: string; distance: number }>;
    };
  }

  async walrusManualRestore(namespace: string): Promise<{ restored: number; skipped: number; total: number; truncated: boolean }> {
    await this.#ready;
    return await this.#request("walrus-manual-restore", { namespace }) as { restored: number; skipped: number; total: number; truncated: boolean };
  }

  async publishWalrusResearchBundle(input: WalrusBundlePublishInput): Promise<WalrusBundlePublishResult> {
    await this.#ready;
    return await this.#request("walrus-bundle-publish", { input }) as WalrusBundlePublishResult;
  }

  dispose(): void {
    this.#disposed = true;
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("Private intelligence stopped"));
    }
    this.#pending.clear();
    this.#process?.kill();
    this.#process = undefined;
  }

  async #start(): Promise<void> {
    if (!this.cipher.available()) {
      this.#status = { ...DEFAULT_STATUS, enabled: this.enabled(), status: "error", message: "macOS secure storage is unavailable." };
      this.onChanged();
      return;
    }
    const modulePath = join(dirname(fileURLToPath(import.meta.url)), "..", "utility", "intelligence.js");
    const child = utilityProcess.fork(modulePath, [], { serviceName: "Locus Private Intelligence" });
    this.#process = child;
    child.on("message", (message) => this.#receive(message as UtilityResponse));
    child.on("exit", () => {
      if (this.#disposed) return;
      this.#process = undefined;
      this.#status = { ...this.#status, status: "error", message: "Private intelligence stopped. Restart Locus Browser to try again." };
      for (const pending of this.#pending.values()) {
        clearTimeout(pending.timeout);
        pending.reject(new Error(this.#status.message));
      }
      this.#pending.clear();
      this.onChanged();
    });
    await this.#request("initialize", {
      databasePath: join(this.dataRoot, "private-intelligence.sqlite3"),
      profileId: this.profileId,
      key: this.#contentKey(),
      helperPath: semanticHelperPath(this.platformRoot),
      enabled: this.enabled(),
    });
    const [status, boards, bundles] = await Promise.all([
      this.#request("status", {}), this.#request("list-boards", {}), this.#request("list-bundles", {}),
    ]);
    this.#status = parseStatus(status, this.enabled());
    this.#boards = Array.isArray(boards) ? boards as ResearchBoardSummaryState[] : [];
    this.#bundles = Array.isArray(bundles) ? bundles as ResumeBundleState[] : [];
    this.onChanged();
  }

  #contentKey(): string {
    const stored = this.database.setting(this.profileId, CONTENT_KEY_SETTING);
    if (typeof stored === "string" && stored) return this.cipher.decrypt(Buffer.from(stored, "base64"));
    const key = randomBytes(32).toString("base64url");
    this.database.setSetting(this.profileId, CONTENT_KEY_SETTING, Buffer.from(this.cipher.encrypt(key)).toString("base64"));
    return key;
  }

  async #request(type: string, payload: Record<string, unknown>): Promise<unknown> {
    const process = this.#process;
    if (!process) throw new Error(this.#status.message || "Private intelligence is unavailable");
    const id = randomUUID();
    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error("Private intelligence did not answer in time"));
      }, utilityRequestTimeout(type));
      this.#pending.set(id, { resolve, reject, timeout });
      process.postMessage({ id, type, payload });
    });
  }

  #receive(message: UtilityResponse): void {
    if (message.type === "status" && message.status) {
      this.#status = parseStatus(message.status, this.enabled());
      this.onChanged();
      return;
    }
    if (!message.id) return;
    const pending = this.#pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.#pending.delete(message.id);
    if (message.ok) pending.resolve(message.value);
    else pending.reject(new Error(message.error || "Private intelligence request failed"));
  }
}

function utilityRequestTimeout(type: string): number {
  if (type === "walrus-bundle-publish") return 10 * 60_000;
  if (type.startsWith("walrus-manual-")) return 3 * 60_000;
  return type === "search" || type === "index" ? 30_000 : 10_000;
}

function parseStatus(value: unknown, enabled: boolean): SemanticRecallState {
  if (!value || typeof value !== "object") return { ...DEFAULT_STATUS, enabled };
  const item = value as Partial<SemanticRecallState>;
  return {
    enabled,
    status: enabled && ["starting", "ready", "indexing", "paused", "error"].includes(String(item.status))
      ? item.status as SemanticRecallState["status"] : enabled ? "ready" : "disabled",
    documentCount: Math.max(0, Number(item.documentCount) || 0),
    storageBytes: Math.max(0, Number(item.storageBytes) || 0),
    capBytes: Math.max(1, Number(item.capBytes) || DEFAULT_STATUS.capBytes),
    excludedOrigins: Array.isArray(item.excludedOrigins) ? item.excludedOrigins.filter((origin): origin is string => typeof origin === "string") : [],
    message: typeof item.message === "string" ? item.message : enabled ? "Private recall is ready." : "Private recall is off.",
  };
}

function semanticHelperPath(platformRoot: string): string {
  const candidates = [
    join(platformRoot, "components", "semantic", "locus-semantic-helper"),
    join(platformRoot, ".build", "release", "locus-semantic-helper"),
    join(platformRoot, ".build", "debug", "locus-semantic-helper"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? "";
}
