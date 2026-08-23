import { describe, expect, it } from "vitest";
import { BrowserCommandSchema } from "./ipc.js";

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

  it("strips credentials from renderer commands before they reach the broker", () => {
    const parsed = BrowserCommandSchema.parse({
      type: "configure-work-provider",
      providerId: "openai-api",
      model: "gpt-5.6",
      apiKey: "sk-must-not-cross-ipc",
    });
    expect(parsed).not.toHaveProperty("apiKey");
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

describe("extension management commands", () => {
  it.each([
    { type: "set-extension-developer-mode", enabled: true },
    { type: "install-unpacked-extension" },
    { type: "install-signed-extension" },
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
