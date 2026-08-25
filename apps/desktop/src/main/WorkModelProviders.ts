import { z } from "zod";
import type { WorkModelOptionState, WorkModelProviderId } from "../shared/types.js";
import type { BrowserDatabase } from "./BrowserDatabase.js";
import type { CredentialCipher } from "./CredentialVault.js";

export type ConfigurableWorkModelProviderId = "openai-api" | "kimi" | "claude-api" | "vllm";

export interface WorkModelProviderDefinition {
  id: WorkModelProviderId;
  name: string;
  shortName: string;
  detail: string;
  mark: string;
  curatedModels: string[];
  baseUrl?: string;
  authStyle?: "bearer" | "anthropic";
  listsModels?: boolean;
  requiresApiKey: boolean;
}

export const WORK_MODEL_PROVIDERS: WorkModelProviderDefinition[] = [
  {
    id: "chatgpt-plan",
    name: "ChatGPT Plan",
    shortName: "ChatGPT Plan",
    detail: "Use included ChatGPT subscription usage",
    mark: "P",
    curatedModels: ["gpt-5.3-codex", "gpt-5.2-codex", "gpt-5.1-codex-max"],
    requiresApiKey: false,
  },
  {
    id: "openai-api",
    name: "ChatGPT API",
    shortName: "ChatGPT API",
    detail: "OpenAI API key and usage billing",
    mark: "O",
    curatedModels: ["gpt-5.6", "gpt-5", "gpt-5-mini", "gpt-4.1", "o3"],
    baseUrl: "https://api.openai.com/v1",
    authStyle: "bearer",
    listsModels: true,
    requiresApiKey: true,
  },
  {
    id: "claude-api",
    name: "Claude API",
    shortName: "Claude",
    detail: "Anthropic API key",
    mark: "C",
    curatedModels: ["claude-opus-5", "claude-sonnet-5", "claude-fable-5", "claude-haiku-4-5"],
    baseUrl: "https://api.anthropic.com/v1",
    authStyle: "anthropic",
    listsModels: true,
    requiresApiKey: true,
  },
  {
    id: "kimi",
    name: "Kimi",
    shortName: "Kimi",
    detail: "Moonshot API models",
    mark: "K",
    curatedModels: ["kimi-k3", "kimi-k2.7-code-highspeed", "kimi-k2.7-code", "kimi-k2.6"],
    baseUrl: "https://api.moonshot.ai/v1",
    authStyle: "bearer",
    listsModels: true,
    requiresApiKey: true,
  },
  {
    id: "vllm",
    name: "vLLM",
    shortName: "vLLM",
    detail: "Your OpenAI-compatible endpoint",
    mark: "V",
    curatedModels: [],
    authStyle: "bearer",
    listsModels: true,
    requiresApiKey: false,
  },
  {
    id: "local",
    name: "Local Models",
    shortName: "Local",
    detail: "Models installed in Ollama",
    mark: "L",
    curatedModels: [],
    requiresApiKey: false,
  },
];

export interface StoredWorkModelProviderConfig {
  baseUrl?: string;
  model: string;
  encryptedApiKey?: string;
}

interface StoredWorkModelSettings {
  activeProvider: WorkModelProviderId;
  providers: Partial<Record<WorkModelProviderId, StoredWorkModelProviderConfig>>;
}

const StoredProviderConfigSchema = z.object({
  baseUrl: z.string().max(2_048).optional(),
  model: z.string().max(1_024).default(""),
  encryptedApiKey: z.string().max(64_000).optional(),
});
const StoredSettingsSchema = z.object({
  activeProvider: z.enum(["chatgpt-plan", "openai-api", "kimi", "claude-api", "vllm", "local"]).default("chatgpt-plan"),
  providers: z.record(z.string(), StoredProviderConfigSchema).default(() => ({})),
});
const SETTINGS_KEY = "workModelProvidersV1";

export class WorkModelProviderStore {
  #settings: StoredWorkModelSettings;

  constructor(
    readonly database: BrowserDatabase,
    readonly cipher: CredentialCipher,
    readonly profileId = "default",
  ) {
    const parsed = StoredSettingsSchema.safeParse(database.setting(profileId, SETTINGS_KEY));
    this.#settings = parsed.success
      ? { activeProvider: parsed.data.activeProvider, providers: parsed.data.providers }
      : { activeProvider: "chatgpt-plan", providers: {} };
  }

  activeProvider(): WorkModelProviderId {
    return this.#settings.activeProvider;
  }

  config(providerId: WorkModelProviderId): StoredWorkModelProviderConfig | undefined {
    const value = this.#settings.providers[providerId];
    return value ? { ...value } : undefined;
  }

  hasApiKey(providerId: WorkModelProviderId): boolean {
    return Boolean(this.#settings.providers[providerId]?.encryptedApiKey);
  }

  apiKey(providerId: WorkModelProviderId): string {
    const encrypted = this.#settings.providers[providerId]?.encryptedApiKey;
    if (!encrypted) return "";
    if (!this.cipher.available()) throw new Error("OS-backed provider-key encryption is unavailable");
    return this.cipher.decrypt(Buffer.from(encrypted, "base64"));
  }

  saveProvider(
    providerId: WorkModelProviderId,
    value: { baseUrl?: string; model: string },
    apiKey?: string,
  ): void {
    const existing = this.#settings.providers[providerId];
    let encryptedApiKey = existing?.encryptedApiKey;
    if (apiKey !== undefined) {
      if (apiKey) {
        if (!this.cipher.available()) throw new Error("OS-backed provider-key encryption is unavailable");
        encryptedApiKey = Buffer.from(this.cipher.encrypt(apiKey)).toString("base64");
      } else {
        encryptedApiKey = undefined;
      }
    }
    this.#settings.providers[providerId] = {
      ...(value.baseUrl ? { baseUrl: value.baseUrl } : {}),
      model: value.model,
      ...(encryptedApiKey ? { encryptedApiKey } : {}),
    };
    this.#persist();
  }

  setActive(providerId: WorkModelProviderId): void {
    this.#settings.activeProvider = providerId;
    this.#persist();
  }

  #persist(): void {
    this.database.setSetting(this.profileId, SETTINGS_KEY, this.#settings);
  }
}

export function workModelProvider(providerId: WorkModelProviderId): WorkModelProviderDefinition {
  return WORK_MODEL_PROVIDERS.find((provider) => provider.id === providerId)!;
}

export function enabledWorkModelProviders(localModelsEnabled: boolean): WorkModelProviderDefinition[] {
  return localModelsEnabled
    ? WORK_MODEL_PROVIDERS
    : WORK_MODEL_PROVIDERS.filter((provider) => provider.id !== "local");
}

export function normalizeProviderSetup(
  providerId: ConfigurableWorkModelProviderId,
  rawBaseUrl: string | undefined,
  rawModel: string,
): { baseUrl: string; model: string } {
  const definition = workModelProvider(providerId);
  const model = rawModel.trim();
  if (!model) throw new Error("Choose a model before connecting this provider");
  const baseUrl = (definition.baseUrl ?? rawBaseUrl ?? "").trim().replace(/\/+$/, "");
  if (!baseUrl) throw new Error("Enter the vLLM endpoint URL");
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error("Enter a valid provider endpoint URL");
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error("Provider endpoints must use HTTP or HTTPS and cannot contain credentials");
  }
  return { baseUrl, model };
}

export function publishedContextWindow(providerId: WorkModelProviderId, model: string): number | undefined {
  const name = model.toLowerCase();
  if (providerId === "openai-api") {
    if (name === "gpt-5.6" || name.startsWith("gpt-5.6-")) return 1_050_000;
    if (name === "gpt-5" || name.startsWith("gpt-5-")) return 400_000;
    if (name.startsWith("gpt-4.1")) return 1_047_576;
    if (name.startsWith("o3") || name.startsWith("o4")) return 200_000;
  }
  if (providerId === "claude-api") {
    if (["opus-5", "sonnet-5", "fable-5"].some((part) => name.includes(part))) return 1_000_000;
    if (name.includes("haiku-4-5") || (name.startsWith("claude-") && name.includes("-4"))) return 200_000;
  }
  if (providerId === "kimi") {
    if (name.includes("256k")) return 256_000;
    if (name === "k3" || name.startsWith("kimi-k3")) return 1_000_000;
    if (name.startsWith("kimi-k2") || name.startsWith("kimi-for-coding")) return 256_000;
    if (name.includes("128k")) return 128_000;
  }
  return undefined;
}

export function deduplicatedWorkModels(values: WorkModelOptionState[]): WorkModelOptionState[] {
  const positions = new Map<string, number>();
  const result: WorkModelOptionState[] = [];
  for (const model of values) {
    const key = model.id.trim().toLowerCase();
    if (!key) continue;
    const existingIndex = positions.get(key);
    if (existingIndex === undefined) {
      positions.set(key, result.length);
      result.push(model);
      continue;
    }
    const existing = result[existingIndex]!;
    result[existingIndex] = {
      ...existing,
      ...(model.name !== model.id || existing.name === existing.id ? { name: model.name } : {}),
      ...(model.detail ? { detail: model.detail } : {}),
      ...(typeof model.vision === "boolean" ? { vision: model.vision } : {}),
    };
  }
  return result;
}
