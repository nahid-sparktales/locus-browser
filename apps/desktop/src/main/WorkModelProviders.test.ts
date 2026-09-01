import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BrowserDatabase } from "./BrowserDatabase.js";
import {
  WORK_MODEL_PROVIDERS,
  KIMI_DEFAULT_MODEL,
  KIMI_MEMBERSHIP_BASE_URL,
  KIMI_MEMBERSHIP_MODELS,
  WorkModelProviderStore,
  deduplicatedWorkModels,
  enabledWorkModelProviders,
  normalizeProviderSetup,
  publishedContextWindow,
  remoteProviderConfiguration,
} from "./WorkModelProviders.js";

const cipher = {
  available: () => true,
  encrypt: (value: string) => Buffer.from(`encrypted:${value}`),
  decrypt: (value: Uint8Array) => Buffer.from(value).toString().replace(/^encrypted:/, ""),
};

describe("WorkModelProviderStore", () => {
  it("keeps hosted providers primary and exposes local models only when enabled", () => {
    expect(WORK_MODEL_PROVIDERS.map((provider) => provider.id)).toEqual([
      "chatgpt-plan", "openai-api", "claude-api", "kimi", "vllm", "local",
    ]);
    expect(enabledWorkModelProviders(false).map((provider) => provider.id)).toEqual([
      "chatgpt-plan", "openai-api", "claude-api", "kimi", "vllm",
    ]);
    expect(enabledWorkModelProviders(true).map((provider) => provider.id)).toContain("local");
  });

  it("defaults new profiles to ChatGPT Plan instead of starting Ollama", () => {
    const database = new BrowserDatabase(join(mkdtempSync(join(tmpdir(), "locus-models-default-")), "browser.sqlite3"));
    const store = new WorkModelProviderStore(database, cipher);
    expect(store.activeProvider()).toBe("chatgpt-plan");
    database.close();
  });

  it("stores API keys encrypted and returns no secret in provider metadata", () => {
    const database = new BrowserDatabase(join(mkdtempSync(join(tmpdir(), "locus-models-")), "browser.sqlite3"));
    const store = new WorkModelProviderStore(database, cipher);
    store.saveProvider("openai-api", { model: "gpt-5.6", baseUrl: "https://api.openai.com/v1" }, "sk-secret");
    store.setActive("openai-api");

    expect(store.activeProvider()).toBe("openai-api");
    expect(store.apiKey("openai-api")).toBe("sk-secret");
    expect(JSON.stringify(database.setting("default", "workModelProvidersV1"))).not.toContain("sk-secret");
    expect(store.config("openai-api")).not.toHaveProperty("apiKey");
    database.close();
  });

  it("validates configurable endpoints and carries Locus context defaults", () => {
    expect(normalizeProviderSetup("vllm", "http://127.0.0.1:8000/v1/", " repo/model ")).toEqual({
      baseUrl: "http://127.0.0.1:8000/v1",
      model: "repo/model",
    });
    expect(() => normalizeProviderSetup("vllm", "file:///tmp/model", "model")).toThrow("HTTP or HTTPS");
    expect(publishedContextWindow("openai-api", "gpt-5.6")).toBe(1_050_000);
    expect(publishedContextWindow("claude-api", "claude-haiku-4-5")).toBe(200_000);
    expect(publishedContextWindow("kimi", "kimi-for-coding")).toBe(256_000);
    expect(publishedContextWindow("kimi", "kimi-for-coding-highspeed")).toBe(256_000);
  });

  it("uses the fixed Kimi Code membership contract", () => {
    const kimi = WORK_MODEL_PROVIDERS.find((provider) => provider.id === "kimi")!;
    expect(kimi.baseUrl).toBe("https://api.kimi.com/coding/v1");
    expect(kimi.curatedModels).toEqual(["kimi-for-coding", "kimi-for-coding-highspeed"]);
    expect(kimi.listsModels).toBe(false);
    expect(remoteProviderConfiguration("kimi", { baseUrl: KIMI_MEMBERSHIP_BASE_URL, model: KIMI_DEFAULT_MODEL }, "membership-key", true)).toMatchObject({
      base_url: "https://api.kimi.com/coding/v1",
      model: "kimi-for-coding",
      lists_models: false,
      published_context_window: 256_000,
      verify: true,
    });
  });

  it("invalidates only a legacy Kimi credential before changing hosts", () => {
    const database = new BrowserDatabase(join(mkdtempSync(join(tmpdir(), "locus-models-migrate-")), "browser.sqlite3"));
    const original = new WorkModelProviderStore(database, cipher);
    original.saveProvider("openai-api", { model: "gpt-5.6", baseUrl: "https://api.openai.com/v1" }, "sk-openai");
    original.saveProvider("kimi", { model: "kimi-k3", baseUrl: "https://api.moonshot.ai/v1" }, "sk-old-kimi");
    original.setActive("openai-api");

    const migrated = new WorkModelProviderStore(database, cipher);
    expect(migrated.config("kimi")).toEqual({ baseUrl: KIMI_MEMBERSHIP_BASE_URL, model: KIMI_DEFAULT_MODEL });
    expect(migrated.hasApiKey("kimi")).toBe(false);
    expect(migrated.apiKey("openai-api")).toBe("sk-openai");
    expect(migrated.activeProvider()).toBe("openai-api");
    expect(KIMI_MEMBERSHIP_MODELS).toContain(migrated.config("kimi")!.model);
    database.close();
  });

  it("clears encrypted credentials without disturbing provider setup", () => {
    const database = new BrowserDatabase(join(mkdtempSync(join(tmpdir(), "locus-models-clear-")), "browser.sqlite3"));
    const store = new WorkModelProviderStore(database, cipher);
    store.saveProvider("claude-api", { model: "claude-sonnet-5", baseUrl: "https://api.anthropic.com/v1" }, "sk-claude");
    store.clearCredential("claude-api");
    expect(store.hasApiKey("claude-api")).toBe(false);
    expect(store.config("claude-api")).toEqual({ model: "claude-sonnet-5", baseUrl: "https://api.anthropic.com/v1" });
    database.close();
  });

  it("deduplicates configured and discovered model names case-insensitively", () => {
    expect(deduplicatedWorkModels([
      { id: "qwen3.6:27b", name: "qwen3.6:27b" },
      { id: "QWEN3.6:27B", name: "QWEN3.6:27B", detail: "27.8B" },
      { id: "gemma3:12b", name: "gemma3:12b" },
    ])).toEqual([
      { id: "qwen3.6:27b", name: "QWEN3.6:27B", detail: "27.8B" },
      { id: "gemma3:12b", name: "gemma3:12b" },
    ]);
  });
});
