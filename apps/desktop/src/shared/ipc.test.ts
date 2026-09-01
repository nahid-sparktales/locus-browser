import { describe, expect, it } from "vitest";
import { BrowserCommandSchema, BrowserQuerySchema } from "./ipc.js";

describe("Work model commands", () => {
  it("accepts the six model sources and validates configurable endpoints", () => {
    for (const providerId of ["chatgpt-plan", "openai-api", "kimi", "claude-api", "vllm", "local"] as const) {
      expect(BrowserCommandSchema.safeParse({ type: "select-work-model", providerId, model: "model-name" }).success).toBe(true);
    }
    expect(BrowserCommandSchema.safeParse({
      type: "configure-work-provider",
      providerId: "vllm",
      baseUrl: "http://127.0.0.1:8000/v1",
      model: "organization/model",
    }).success).toBe(true);
  });

  it("validates full-page settings and the local-model opt-in", () => {
    expect(BrowserCommandSchema.safeParse({ type: "open-settings" }).success).toBe(true);
    expect(BrowserCommandSchema.safeParse({ type: "close-settings" }).success).toBe(true);
    expect(BrowserCommandSchema.safeParse({ type: "set-local-models-enabled", enabled: true }).success).toBe(true);
    expect(BrowserCommandSchema.safeParse({ type: "set-local-models-enabled", enabled: "yes" }).success).toBe(false);
    expect(BrowserCommandSchema.safeParse({
      type: "execute-palette-action",
      action: { type: "open-settings-section", section: "privacy", anchor: "settings-passwords" },
    }).success).toBe(true);
    expect(BrowserCommandSchema.safeParse({
      type: "execute-palette-action",
      action: { type: "open-settings-section", section: "made-up" },
    }).success).toBe(false);
    expect(BrowserCommandSchema.safeParse({
      type: "execute-palette-action",
      action: { type: "open-settings-section", section: "privacy", anchor: "<script>" },
    }).success).toBe(false);
  });

  it("accepts only the complete Locus accent palette and normalized custom colours", () => {
    for (const preset of ["lime", "green", "blue", "purple", "orange", "pink", "neutral", "custom"] as const) {
      expect(BrowserCommandSchema.safeParse({ type: "set-accent-color", preset, customHex: "4A90FF" }).success).toBe(true);
    }
    expect(BrowserCommandSchema.safeParse({ type: "set-accent-color", preset: "teal", customHex: "4A90FF" }).success).toBe(false);
    expect(BrowserCommandSchema.safeParse({ type: "set-accent-color", preset: "custom", customHex: "#4A90FF" }).success).toBe(false);
    expect(BrowserCommandSchema.safeParse({ type: "set-accent-color", preset: "custom", customHex: "4A90FF", apiKey: "secret" }).success).toBe(false);
  });

  it("rejects credentials before renderer commands reach the broker", () => {
    expect(BrowserCommandSchema.safeParse({
      type: "configure-work-provider",
      providerId: "openai-api",
      model: "gpt-5.6",
      apiKey: "credential-must-not-cross-ipc",
    }).success).toBe(false);
  });

  it("allowlists credential actions and never accepts a renderer secret", () => {
    expect(BrowserCommandSchema.safeParse({
      type: "test-work-provider-credential", providerId: "kimi", model: "kimi-for-coding", apiKey: "must-not-cross-ipc",
    }).success).toBe(false);
    expect(BrowserCommandSchema.safeParse({ type: "test-work-provider-credential", providerId: "unknown" }).success).toBe(false);
    expect(BrowserCommandSchema.safeParse({ type: "remove-work-provider-credential", providerId: "chatgpt-plan" }).success).toBe(false);
    expect(BrowserCommandSchema.safeParse({ type: "remove-work-provider-credential", providerId: "kimi" }).success).toBe(true);
  });
});

describe("Solo Work surface commands", () => {
  it("bounds renderer-selected workspace paths", () => {
    expect(BrowserCommandSchema.safeParse({ type: "select-work-change", path: "src/app.ts", staged: true }).success).toBe(true);
    expect(BrowserCommandSchema.safeParse({ type: "select-work-file", path: "README.md" }).success).toBe(true);
    expect(BrowserCommandSchema.safeParse({ type: "select-work-file", path: "x".repeat(2_049) }).success).toBe(false);
  });

  it.each(["request-work-plan", "approve-work-plan", "revise-work-plan", "refresh-work-changes", "refresh-work-files", "clear-work-terminal", "restart-work-runtime"])("accepts %s", (type) => {
    expect(BrowserCommandSchema.safeParse({ type }).success).toBe(true);
  });
});

describe("live recording commands", () => {
  it("keeps tab and work-session selection inside the browser broker", () => {
    const parsed = BrowserCommandSchema.parse({
      type: "start-recording", shareLevel: "interact", tabAudio: true,
      microphone: true, saveVideo: false, tabId: "forged-tab", sessionId: "forged-session",
    });
    expect(parsed).not.toHaveProperty("tabId");
    expect(parsed).not.toHaveProperty("sessionId");
  });

  it("validates speech configuration and transcript identities", () => {
    expect(BrowserCommandSchema.safeParse({
      type: "configure-speech", engine: "custom", language: "auto",
      baseUrl: "https://speech.example.com/v1", model: "whisper-1",
    }).success).toBe(true);
    expect(BrowserCommandSchema.safeParse({
      type: "configure-speech", engine: "custom", language: "auto",
      baseUrl: "https://speech.example.com/v1", model: "whisper-1", apiKey: "secret",
    }).success).toBe(false);
    expect(BrowserCommandSchema.safeParse({ type: "delete-recording-transcript", recordingId: "not-a-uuid" }).success).toBe(false);
  });
});

describe("extension management commands", () => {
  it.each([
    { type: "set-extension-developer-mode", enabled: true },
    { type: "install-unpacked-extension" },
    { type: "install-signed-extension" },
    { type: "refresh-extension-gallery" },
    { type: "install-gallery-extension", extensionId: "extension-1" },
    { type: "set-extension-enabled", extensionId: "extension-1", enabled: false },
    { type: "rollback-extension", extensionId: "extension-1" },
    { type: "remove-extension", extensionId: "extension-1" },
  ])("accepts and bounds $type", (command) => {
    expect(BrowserCommandSchema.safeParse(command).success).toBe(true);
  });

  it("rejects oversized extension identifiers", () => {
    expect(BrowserCommandSchema.safeParse({ type: "remove-extension", extensionId: "x".repeat(256) }).success).toBe(false);
  });
});

describe("browser intelligence and productivity commands", () => {
  it("bounds Split View, Recall, Research, Steward, Reader and palette messages", () => {
    for (const value of [
      { type: "set-split-ratio", ratio: 0.5 },
      { type: "set-semantic-recall-enabled", enabled: true },
      { type: "generate-research-board", tabIds: ["tab-1"], prompt: "Compare the evidence", format: "comparison" },
      { type: "save-resume-bundle", name: "Later", tabIds: ["tab-1"], closeAfter: false },
      { type: "set-reader-preferences", theme: "paper", textScale: 1.2, rate: 1.1 },
      { type: "execute-palette-action", action: { type: "toggle-split" } },
    ]) expect(BrowserCommandSchema.safeParse(value).success).toBe(true);
    expect(BrowserCommandSchema.safeParse({ type: "set-split-ratio", ratio: 0.9 }).success).toBe(false);
    expect(BrowserCommandSchema.safeParse({ type: "generate-research-board", tabIds: Array.from({ length: 11 }, (_, index) => `tab-${index}`), prompt: "x", format: "brief" }).success).toBe(false);
  });

  it("keeps bulky intelligence data behind typed queries", () => {
    expect(BrowserQuerySchema.safeParse({ type: "palette-search", query: "split", limit: 30 }).success).toBe(true);
    expect(BrowserQuerySchema.safeParse({ type: "semantic-recall-search", query: "local models last week", limit: 20 }).success).toBe(true);
    expect(BrowserQuerySchema.safeParse({ type: "palette-search", query: "x", limit: 101 }).success).toBe(false);
  });
});
