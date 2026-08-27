import { MemWal } from "@mysten-incubation/memwal";
import { z } from "zod";
import type { WalrusMemoryMode, WalrusMemoryResultState, WalrusMemoryState } from "../shared/types.js";
import type { WalrusManualConfiguration } from "../shared/walrusPrivate.js";
import type { BrowserDatabase, StoredWalrusMemoryReceipt } from "./BrowserDatabase.js";
import type { CredentialCipher } from "./CredentialVault.js";
import { parsePortableMemory } from "./PortableMemory.js";

export const WALRUS_PRODUCTION_RELAYER = "https://relayer.memory.walrus.xyz";
export const WALRUS_DEFAULT_NAMESPACE = "locus-browser-v1";
export const WALRUS_DELEGATES_URL = "https://memory.walrus.xyz";
export const WALRUS_DEFAULT_EMBEDDING_BASE = "https://api.openai.com/v1";
export const WALRUS_DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";

const SETTINGS_KEY = "walrusMemoryConfigV1";
const CREDENTIAL_KEY = "walrusMemoryCredentialV1";
const SUI_CREDENTIAL_KEY = "walrusManualSuiCredentialV1";
const EMBEDDING_CREDENTIAL_KEY = "walrusManualEmbeddingCredentialV1";
const ManualConfigSchema = z.object({
  network: z.enum(["mainnet", "testnet"]),
  packageId: z.string().min(3).max(128),
  registryId: z.string().min(3).max(128),
  embeddingApiBase: z.string().url().max(2_048),
  embeddingModel: z.string().min(1).max(255),
  signerAddress: z.string().min(3).max(128).optional(),
});
const ConfigSchema = z.object({
  accountId: z.string().min(3).max(128),
  namespace: z.string().min(1).max(128),
  relayerUrl: z.string().url().max(2_048),
  mode: z.enum(["hosted", "client-encrypted"]).optional().default("hosted"),
  manual: ManualConfigSchema.optional(),
  connectedAt: z.number().finite().positive().optional(),
});
const CredentialSchema = z.object({ encryptedDelegateKey: z.string().min(1).max(64_000) });
const EncryptedSecretSchema = z.object({ encryptedValue: z.string().min(1).max(64_000) });
type StoredConfig = z.infer<typeof ConfigSchema>;

interface MemWalLike {
  compatibility(): Promise<unknown>;
  recall(options: { query: string; limit: number; namespace: string; maxTokens?: number }): Promise<{
    results: Array<{ blob_id: string; text: string; distance: number }>;
  }>;
  rememberAsync(text: string, namespace?: string): Promise<{ job_id: string; status: string }>;
  getRememberStatus(jobId: string): Promise<{
    job_id: string;
    status: StoredWalrusMemoryReceipt["status"];
    blob_id?: string;
    error?: string;
  }>;
  waitForRememberJob(jobId: string, options?: { pollIntervalMs?: number; timeoutMs?: number }): Promise<{
    id: string;
    job_id?: string;
    blob_id: string;
    namespace: string;
  }>;
  restore(namespace: string, limit?: number): Promise<{
    restored: number;
    skipped: number;
    total: number;
    truncated: boolean;
  }>;
  destroy(): void;
}

export interface WalrusManualBridge {
  configureWalrusManual(config: WalrusManualConfiguration): Promise<{ signerAddress: string }>;
  disconnectWalrusManual(): Promise<void>;
  walrusManualRemember(text: string, namespace: string): Promise<{ id: string; blob_id: string; namespace: string }>;
  walrusManualRecall(query: string, limit: number, namespace: string): Promise<{
    results: Array<{ blob_id: string; text: string; distance: number }>;
  }>;
  walrusManualRestore(namespace: string): Promise<{ restored: number; skipped: number; total: number; truncated: boolean }>;
}

export interface WalrusMemoryClientOptions {
  packaged: boolean;
  manualBridge?: WalrusManualBridge;
  createClient?: (config: { key: string; accountId: string; serverUrl: string; namespace: string }) => MemWalLike;
  onChanged?: () => void;
}

export class WalrusMemoryClient {
  #client: MemWalLike | undefined;
  #manualReady = false;
  #status: WalrusMemoryState["status"] = "disconnected";
  #message = "Connect a Walrus Memory account to save selected findings.";
  #lastSuccessAt: number | undefined;
  #signerAddress: string | undefined;
  readonly #createClient: NonNullable<WalrusMemoryClientOptions["createClient"]>;

  constructor(
    readonly database: BrowserDatabase,
    readonly cipher: CredentialCipher,
    readonly profileId: string,
    readonly options: WalrusMemoryClientOptions,
  ) {
    this.#createClient = options.createClient ?? ((config) => MemWal.create(config));
  }

  state(): WalrusMemoryState {
    const config = this.#storedConfig();
    const manual = config?.manual;
    const signerAddress = this.#signerAddress ?? manual?.signerAddress;
    return {
      status: this.#status,
      usable: config?.mode === "client-encrypted" ? this.#manualReady : Boolean(this.#client),
      message: this.#message,
      mode: config?.mode ?? "hosted",
      ...(config?.accountId ? { accountId: config.accountId } : {}),
      namespace: config?.namespace ?? WALRUS_DEFAULT_NAMESPACE,
      relayerUrl: config?.relayerUrl ?? WALRUS_PRODUCTION_RELAYER,
      developmentRelayerAllowed: !this.options.packaged,
      manualConfigured: Boolean(manual && this.#hasEncryptedSecret(SUI_CREDENTIAL_KEY) && this.#hasEncryptedSecret(EMBEDDING_CREDENTIAL_KEY)),
      ...(manual ? {
        network: manual.network,
        packageId: manual.packageId,
        registryId: manual.registryId,
        embeddingApiBase: manual.embeddingApiBase,
        embeddingModel: manual.embeddingModel,
      } : {}),
      ...(signerAddress ? { signerAddress } : {}),
      ...(config?.connectedAt ? { connectedAt: config.connectedAt } : {}),
      ...(this.#lastSuccessAt ? { lastSuccessAt: this.#lastSuccessAt } : {}),
      receiptCount: this.database.listWalrusMemoryReceipts(this.profileId).length,
    };
  }

  async initialize(): Promise<void> {
    const config = this.#storedConfig();
    const credential = this.#delegateKey();
    if (!config || !credential) return;
    this.#status = "checking";
    this.#message = config.mode === "client-encrypted"
      ? "Checking client-side encryption, embedding compatibility, and delegate access…"
      : "Checking the Walrus relayer and delegate…";
    this.#changed();
    try {
      if (config.mode === "client-encrypted") await this.#activateManual(config, credential);
      else {
        await this.#activateHosted(config, credential);
        await this.#refreshOpenReceipts();
      }
      this.#status = "connected";
      this.#message = connectedMessage(config.mode);
      this.#lastSuccessAt = Date.now();
    } catch (error) {
      await this.#destroyClients();
      this.#status = "error";
      this.#message = safeWalrusError(error);
    }
    this.#changed();
  }

  async connect(accountId: string, namespace: string, delegateKey: string, requestedRelayer?: string): Promise<void> {
    if (!this.cipher.available()) throw new Error("OS-backed delegate-key encryption is unavailable");
    const normalized = normalizeWalrusConfig(accountId, namespace, requestedRelayer, this.options.packaged);
    const config: StoredConfig = { ...normalized, mode: "hosted" };
    if (!delegateKey.trim()) throw new Error("Enter the Walrus delegate key");
    this.#status = "checking";
    this.#message = "Checking SDK compatibility and delegate access…";
    this.#changed();
    await this.#destroyClients();
    try {
      await this.#activateHosted(config, delegateKey.trim());
      const connectedAt = Date.now();
      this.database.setSetting(this.profileId, SETTINGS_KEY, { ...config, connectedAt });
      this.#saveEncryptedSecret(CREDENTIAL_KEY, "encryptedDelegateKey", delegateKey.trim());
      this.database.deleteSetting(this.profileId, SUI_CREDENTIAL_KEY);
      this.database.deleteSetting(this.profileId, EMBEDDING_CREDENTIAL_KEY);
      this.#status = "connected";
      this.#message = connectedMessage("hosted");
      this.#lastSuccessAt = connectedAt;
    } catch (error) {
      await this.#destroyClients();
      this.#status = "error";
      this.#message = safeWalrusError(error);
      throw new Error(this.#message);
    } finally { this.#changed(); }
  }

  async configureClientEncrypted(value: {
    network: "mainnet" | "testnet";
    packageId: string;
    registryId: string;
    embeddingApiBase: string;
    embeddingModel: string;
    suiPrivateKey: string;
    embeddingApiKey: string;
  }): Promise<void> {
    const config = this.#storedConfig();
    const delegateKey = this.#delegateKey();
    if (!config || !delegateKey) throw new Error("Connect a Walrus delegate before enabling client-encrypted mode");
    if (!this.options.manualBridge) throw new Error("Private intelligence is unavailable for client-encrypted mode");
    const manual = normalizeManualConfig(value);
    this.#status = "checking";
    this.#message = "Validating local encryption and embedding-vector compatibility…";
    this.#changed();
    await this.#destroyClients();
    try {
      const activated = await this.options.manualBridge.configureWalrusManual({
        ...manual,
        delegateKey,
        suiPrivateKey: value.suiPrivateKey,
        embeddingApiKey: value.embeddingApiKey,
        accountId: config.accountId,
        namespace: config.namespace,
        relayerUrl: config.relayerUrl,
      });
      const connectedAt = Date.now();
      const updated: StoredConfig = { ...config, mode: "client-encrypted", manual: { ...manual, signerAddress: activated.signerAddress }, connectedAt };
      this.database.setSetting(this.profileId, SETTINGS_KEY, updated);
      this.#saveEncryptedSecret(SUI_CREDENTIAL_KEY, "encryptedValue", value.suiPrivateKey);
      this.#saveEncryptedSecret(EMBEDDING_CREDENTIAL_KEY, "encryptedValue", value.embeddingApiKey);
      this.#manualReady = true;
      this.#signerAddress = activated.signerAddress;
      this.#status = "connected";
      this.#message = connectedMessage("client-encrypted");
      this.#lastSuccessAt = connectedAt;
    } catch (error) {
      await this.#destroyClients();
      this.#status = "error";
      this.#message = safeWalrusError(error);
      throw new Error(this.#message);
    } finally { this.#changed(); }
  }

  async setMode(mode: WalrusMemoryMode): Promise<void> {
    const config = this.#storedConfig();
    const delegateKey = this.#delegateKey();
    if (!config || !delegateKey) throw new Error("Connect Walrus Memory first");
    if (mode === config.mode && this.state().usable) return;
    if (mode === "client-encrypted" && (!config.manual || !this.#hasEncryptedSecret(SUI_CREDENTIAL_KEY) || !this.#hasEncryptedSecret(EMBEDDING_CREDENTIAL_KEY))) {
      throw new Error("Configure client-encrypted mode before selecting it");
    }
    this.#status = "checking";
    this.#message = `Switching to ${mode === "client-encrypted" ? "client-encrypted" : "hosted"} mode…`;
    this.#changed();
    await this.#destroyClients();
    try {
      const updated = { ...config, mode };
      if (mode === "client-encrypted") await this.#activateManual(updated, delegateKey);
      else await this.#activateHosted(updated, delegateKey);
      this.database.setSetting(this.profileId, SETTINGS_KEY, updated);
      this.#status = "connected";
      this.#message = connectedMessage(mode);
      this.#lastSuccessAt = Date.now();
    } catch (error) {
      this.#status = "error";
      this.#message = safeWalrusError(error);
      throw new Error(this.#message);
    } finally { this.#changed(); }
  }

  async disconnect(): Promise<void> {
    const destroyed = this.#destroyClients();
    this.database.deleteSetting(this.profileId, CREDENTIAL_KEY);
    this.database.deleteSetting(this.profileId, SUI_CREDENTIAL_KEY);
    this.database.deleteSetting(this.profileId, EMBEDDING_CREDENTIAL_KEY);
    this.#status = "disconnected";
    this.#message = "Disconnected locally. Memories and research bundles already stored on Walrus still exist.";
    this.#changed();
    await destroyed;
  }

  async remember(text: string): Promise<{ jobId: string; blobId: string }> {
    const config = this.#requireUsableConfig();
    this.#status = "saving";
    this.#message = config.mode === "client-encrypted"
      ? "Embedding and encrypting inside Locus, then waiting for Walrus storage…"
      : "Walrus accepted content only after your confirmation. Waiting for storage to finish…";
    this.#changed();
    return config.mode === "client-encrypted" ? await this.#rememberManual(text, config) : await this.#rememberHosted(text, config);
  }

  async recall(query: string, limit = 10): Promise<WalrusMemoryResultState[]> {
    const config = this.#requireUsableConfig();
    try {
      const response = config.mode === "client-encrypted"
        ? await this.options.manualBridge!.walrusManualRecall(query.trim(), Math.min(limit, 10), config.namespace)
        : await this.#requireHosted().recall({ query: query.trim(), limit: Math.min(limit, 10), namespace: config.namespace, maxTokens: 3_000 });
      this.#status = "connected";
      this.#message = response.results.length
        ? `Found ${response.results.length} remote ${response.results.length === 1 ? "memory" : "memories"}.`
        : "No indexed matches yet. Recent saves can take a moment; use Restore index if needed.";
      this.#lastSuccessAt = Date.now();
      return response.results.slice(0, 10).flatMap((result) => typeof result.text === "string"
        ? [parsePortableMemory(result.blob_id, result.text, result.distance)] : []);
    } catch (error) {
      this.#status = "error";
      this.#message = safeWalrusError(error);
      throw new Error(this.#message);
    } finally { this.#changed(); }
  }

  async restore(): Promise<void> {
    const config = this.#requireUsableConfig();
    this.#status = "restoring";
    this.#message = "Restoring missing index entries from Walrus…";
    this.#changed();
    try {
      const result = config.mode === "client-encrypted"
        ? await this.options.manualBridge!.walrusManualRestore(config.namespace)
        : await this.#requireHosted().restore(config.namespace, 100);
      this.#status = "connected";
      this.#message = `Index restore finished: ${result.restored} restored, ${result.skipped} already indexed${result.truncated ? ". More items may remain; run Restore index again." : "."}`;
      this.#lastSuccessAt = Date.now();
    } catch (error) {
      this.#status = "error";
      this.#message = safeWalrusError(error);
      throw new Error(this.#message);
    } finally { this.#changed(); }
  }

  setPublishing(publishing: boolean, message?: string): void {
    this.#status = publishing ? "publishing" : "connected";
    this.#message = message ?? (publishing ? "Signing and publishing the verified research bundle…" : connectedMessage(this.#storedConfig()?.mode ?? "hosted"));
    if (!publishing) this.#lastSuccessAt = Date.now();
    this.#changed();
  }

  dispose(): void { void this.#destroyClients(); }

  async #activateHosted(config: Pick<StoredConfig, "accountId" | "namespace" | "relayerUrl">, delegateKey: string): Promise<void> {
    const client = this.#createClient({ key: delegateKey, accountId: config.accountId, serverUrl: config.relayerUrl, namespace: config.namespace });
    this.#client = client;
    await client.compatibility();
    await client.recall({ query: "Locus connection verification", limit: 1, namespace: config.namespace, maxTokens: 8 });
  }

  async #activateManual(config: StoredConfig, delegateKey: string): Promise<void> {
    const manual = config.manual;
    const suiPrivateKey = this.#encryptedSecret(SUI_CREDENTIAL_KEY);
    const embeddingApiKey = this.#encryptedSecret(EMBEDDING_CREDENTIAL_KEY);
    if (!manual || !suiPrivateKey || !embeddingApiKey || !this.options.manualBridge) throw new Error("Client-encrypted Walrus credentials are incomplete");
    const activated = await this.options.manualBridge.configureWalrusManual({
      ...manual,
      delegateKey,
      suiPrivateKey,
      embeddingApiKey,
      accountId: config.accountId,
      namespace: config.namespace,
      relayerUrl: config.relayerUrl,
    });
    this.#manualReady = true;
    this.#signerAddress = activated.signerAddress;
  }

  async #rememberManual(text: string, config: StoredConfig): Promise<{ jobId: string; blobId: string }> {
    const createdAt = Date.now();
    try {
      const completed = await this.options.manualBridge!.walrusManualRemember(text, config.namespace);
      this.#saveReceipt({ jobId: completed.id, blobId: completed.blob_id, namespace: config.namespace, status: "done", createdAt, updatedAt: Date.now() });
      this.#status = "connected";
      this.#message = "Saved with client-side embedding and encryption.";
      this.#lastSuccessAt = Date.now();
      return { jobId: completed.id, blobId: completed.blob_id };
    } catch (error) {
      this.#status = "error";
      this.#message = safeWalrusError(error);
      throw new Error(this.#message);
    } finally { this.#changed(); }
  }

  async #rememberHosted(text: string, config: StoredConfig): Promise<{ jobId: string; blobId: string }> {
    const client = this.#requireHosted();
    let jobId = "";
    const createdAt = Date.now();
    try {
      const accepted = await client.rememberAsync(text, config.namespace);
      jobId = accepted.job_id;
      this.#saveReceipt({ jobId, namespace: config.namespace, status: "pending", createdAt, updatedAt: createdAt });
      const completed = await client.waitForRememberJob(jobId, { pollIntervalMs: 1_500, timeoutMs: 120_000 });
      this.#saveReceipt({ jobId, blobId: completed.blob_id, namespace: config.namespace, status: "done", createdAt, updatedAt: Date.now() });
      this.#status = "connected";
      this.#message = "Saved to Walrus Memory.";
      this.#lastSuccessAt = Date.now();
      return { jobId, blobId: completed.blob_id };
    } catch (error) {
      const status = jobId ? await client.getRememberStatus(jobId).catch(() => undefined) : undefined;
      if (jobId && status?.status === "done" && status.blob_id) {
        this.#saveReceipt({ jobId, blobId: status.blob_id, namespace: config.namespace, status: "done", createdAt, updatedAt: Date.now() });
        this.#status = "connected";
        this.#message = "Saved to Walrus Memory.";
        this.#lastSuccessAt = Date.now();
        return { jobId, blobId: status.blob_id };
      }
      if (jobId) this.#saveReceipt({
        jobId,
        ...(status?.blob_id ? { blobId: status.blob_id } : {}),
        namespace: config.namespace,
        status: status?.status ?? "timeout",
        createdAt,
        updatedAt: Date.now(),
      });
      this.#status = "error";
      this.#message = safeWalrusError(error);
      throw new Error(this.#message);
    } finally { this.#changed(); }
  }

  #storedConfig(): StoredConfig | undefined {
    const parsed = ConfigSchema.safeParse(this.database.setting(this.profileId, SETTINGS_KEY));
    if (!parsed.success) return undefined;
    return { ...parsed.data, relayerUrl: this.options.packaged ? WALRUS_PRODUCTION_RELAYER : parsed.data.relayerUrl };
  }

  #delegateKey(): string | undefined {
    const parsed = CredentialSchema.safeParse(this.database.setting(this.profileId, CREDENTIAL_KEY));
    if (!parsed.success || !this.cipher.available()) return undefined;
    try { return this.cipher.decrypt(Buffer.from(parsed.data.encryptedDelegateKey, "base64")); }
    catch { return undefined; }
  }

  #encryptedSecret(key: string): string | undefined {
    const parsed = EncryptedSecretSchema.safeParse(this.database.setting(this.profileId, key));
    if (!parsed.success || !this.cipher.available()) return undefined;
    try { return this.cipher.decrypt(Buffer.from(parsed.data.encryptedValue, "base64")); }
    catch { return undefined; }
  }

  #hasEncryptedSecret(key: string): boolean {
    return EncryptedSecretSchema.safeParse(this.database.setting(this.profileId, key)).success;
  }

  #saveEncryptedSecret(key: string, field: "encryptedDelegateKey" | "encryptedValue", value: string): void {
    this.database.setSetting(this.profileId, key, { [field]: Buffer.from(this.cipher.encrypt(value)).toString("base64") });
  }

  #requireUsableConfig(): StoredConfig {
    const config = this.#storedConfig();
    const usable = config?.mode === "client-encrypted" ? this.#manualReady : Boolean(this.#client);
    if (!config || !usable || this.#status === "disconnected" || this.#status === "checking") throw new Error("Connect Walrus Memory in Settings first");
    return config;
  }

  #requireHosted(): MemWalLike {
    if (!this.#client) throw new Error("Hosted Walrus Memory is not connected");
    return this.#client;
  }

  #saveReceipt(receipt: StoredWalrusMemoryReceipt): void { this.database.saveWalrusMemoryReceipt(this.profileId, receipt); }

  async #refreshOpenReceipts(): Promise<void> {
    const client = this.#client;
    if (!client) return;
    const open = this.database.listWalrusMemoryReceipts(this.profileId)
      .filter((receipt) => !["done", "failed", "not_found"].includes(receipt.status)).slice(0, 20);
    for (const receipt of open) {
      const status = await client.getRememberStatus(receipt.jobId).catch(() => undefined);
      if (!status) continue;
      this.#saveReceipt({ ...receipt, ...(status.blob_id ? { blobId: status.blob_id } : {}), status: status.status, updatedAt: Date.now() });
    }
  }

  async #destroyClients(): Promise<void> {
    this.#client?.destroy();
    this.#client = undefined;
    this.#manualReady = false;
    this.#signerAddress = undefined;
    await this.options.manualBridge?.disconnectWalrusManual().catch(() => undefined);
  }

  #changed(): void { this.options.onChanged?.(); }
}

export function normalizeWalrusConfig(accountId: string, namespace: string, requestedRelayer: string | undefined, packaged: boolean): {
  accountId: string;
  namespace: string;
  relayerUrl: string;
} {
  const normalizedAccountId = accountId.trim();
  if (!/^0x[a-fA-F0-9]{1,128}$/.test(normalizedAccountId)) throw new Error("Enter a valid Walrus Memory account ID beginning with 0x");
  const normalizedNamespace = namespace.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(normalizedNamespace)) throw new Error("Namespaces may use letters, numbers, dots, underscores, colons, and hyphens");
  const relayerUrl = packaged ? WALRUS_PRODUCTION_RELAYER : (requestedRelayer?.trim() || WALRUS_PRODUCTION_RELAYER);
  let relayer: URL;
  try { relayer = new URL(relayerUrl); }
  catch { throw new Error("Enter a valid Walrus relayer URL"); }
  const localDevelopment = !packaged && ["localhost", "127.0.0.1", "::1"].includes(relayer.hostname);
  if (relayer.protocol !== "https:" && !(localDevelopment && relayer.protocol === "http:")) throw new Error("Walrus relayers must use HTTPS, except localhost during development");
  if (relayer.username || relayer.password || relayer.search || relayer.hash) throw new Error("Walrus relayer URLs cannot contain credentials, queries, or fragments");
  return { accountId: normalizedAccountId, namespace: normalizedNamespace, relayerUrl: relayer.toString().replace(/\/$/, "") };
}

function normalizeManualConfig(value: {
  network: "mainnet" | "testnet";
  packageId: string;
  registryId: string;
  embeddingApiBase: string;
  embeddingModel: string;
}): z.infer<typeof ManualConfigSchema> {
  for (const [label, raw] of [["package", value.packageId], ["registry", value.registryId]] as const) {
    if (!/^0x[0-9a-fA-F]{1,64}$/.test(raw.trim())) throw new Error(`Enter a valid Walrus ${label} ID beginning with 0x`);
  }
  const embeddingApiBase = new URL(value.embeddingApiBase.trim());
  const loopback = ["localhost", "127.0.0.1", "::1"].includes(embeddingApiBase.hostname);
  if (embeddingApiBase.protocol !== "https:" && !loopback) throw new Error("Embedding endpoints must use HTTPS except on this Mac");
  if (embeddingApiBase.username || embeddingApiBase.password || embeddingApiBase.search || embeddingApiBase.hash) throw new Error("Embedding endpoint URLs cannot contain credentials, queries, or fragments");
  const embeddingModel = value.embeddingModel.trim();
  if (!embeddingModel) throw new Error("Enter an embedding model");
  return {
    network: value.network,
    packageId: value.packageId.trim(),
    registryId: value.registryId.trim(),
    embeddingApiBase: embeddingApiBase.toString().replace(/\/$/, ""),
    embeddingModel,
  };
}

function connectedMessage(mode: WalrusMemoryMode): string {
  return mode === "client-encrypted"
    ? "Client-encrypted mode is active. Plaintext stays in Locus; the configured embedding provider still receives it."
    : "Hosted mode is active. Uploads and recall happen only when you ask.";
}

export function safeWalrusError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/embedding.*(401|403|unauthor|api.?key)|invalid.*embedding.*key/i.test(message)) return "The embedding provider rejected its dedicated credential.";
  if (/dimension|vector.*compatib|embedding.*compatib/i.test(message)) return "This embedding model is not vector-compatible with the selected Walrus Memory account.";
  if (/sui.*(balance|coin)|insufficient.*(sui|wal)|gas|wal coin/i.test(message)) return "The dedicated Sui signer needs enough SUI and WAL for this operation.";
  if (/\b401\b|unauthori[sz]ed|delegate|signature/i.test(message)) return "Walrus rejected this delegate. Check the account, environment, and whether the delegate was revoked.";
  if (/\b426\b|compatib|api version|sdk version/i.test(message)) return "This Walrus relayer is not compatible with the pinned Locus SDK.";
  if (/\b429\b|rate.?limit/i.test(message)) return "Walrus is rate limiting requests. Wait a moment, then try again.";
  if (/timeout|timed out/i.test(message)) return "Walrus did not finish in time. The content-free job receipt was kept so you can retry safely.";
  if (/fetch|network|offline|ECONN|ENOTFOUND/i.test(message)) return "Walrus or the selected embedding service is offline or unreachable.";
  return "Walrus Memory could not complete the request. Check the connection and try again.";
}
