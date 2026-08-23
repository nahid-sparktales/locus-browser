import { describe, expect, it } from "vitest";
import type { BrowserCommand } from "../shared/ipc.js";
import { requiresShellSender } from "./BrowserCommandPolicy.js";

describe("browser command sender policy", () => {
  it.each<BrowserCommand>([
    { type: "complete-onboarding", searchEngine: "brave", appearance: "dark", sleepAfterMinutes: 30 },
    { type: "autofill-credential", credentialId: "login-1" },
    { type: "save-pending-credential" },
    { type: "dismiss-pending-credential" },
    { type: "delete-credential", credentialId: "login-1" },
    { type: "set-extension-developer-mode", enabled: true },
    { type: "install-unpacked-extension" },
    { type: "install-signed-extension" },
    { type: "refresh-extension-gallery" },
    { type: "install-gallery-extension", extensionId: "extension-1" },
    { type: "set-extension-enabled", extensionId: "extension-1", enabled: false },
    { type: "rollback-extension", extensionId: "extension-1" },
    { type: "remove-extension", extensionId: "extension-1" },
    { type: "begin-sync-registration", displayName: "Personal", serviceUrl: "https://sync.example.com" },
    { type: "begin-sync-sign-in", recoveryKey: "LOCUS-AAAAA-BBBBB-CCCCC-DDDDD-EEEEE-FFFFF-GGGGG-HHHHH", serviceUrl: "https://sync.example.com" },
    { type: "begin-sync-device-enrollment", serviceUrl: "https://sync.example.com" },
    { type: "check-sync-device-enrollment" },
    { type: "cancel-sync-device-enrollment" },
    { type: "copy-sync-pairing-code" },
    { type: "approve-sync-device", pairingCode: "LOCUS-DEVICE:00000000-0000-4000-8000-000000000000:abcdefghijklmnopqrstuvwx" },
    { type: "revoke-sync-device", deviceId: "device-remote" },
    { type: "rotate-sync-recovery-key" },
    { type: "sync-now" },
    { type: "disconnect-sync" },
    { type: "delete-sync-cloud-data" },
    { type: "delete-sync-account" },
  ])("keeps $type on the trusted browser-chrome sender", (command) => {
    expect(requiresShellSender(command)).toBe(true);
  });

  it("allows ordinary browser and Work commands through their existing sender policy", () => {
    expect(requiresShellSender({ type: "toggle-work" })).toBe(false);
    expect(requiresShellSender({ type: "new-work-conversation" })).toBe(false);
    expect(requiresShellSender({ type: "select-work-conversation", sessionId: "session-1" })).toBe(false);
    expect(requiresShellSender({ type: "choose-workspace" })).toBe(false);
    expect(requiresShellSender({ type: "choose-work-attachments" })).toBe(false);
    expect(requiresShellSender({ type: "select-work-model", providerId: "local", model: "qwen3.6:27b" })).toBe(false);
    expect(requiresShellSender({ type: "configure-work-provider", providerId: "openai-api", model: "gpt-5.6" })).toBe(false);
    expect(requiresShellSender({ type: "start-chatgpt-login" })).toBe(false);
    expect(requiresShellSender({ type: "request-work-plan" })).toBe(false);
    expect(requiresShellSender({ type: "select-work-change", path: "src/app.ts" })).toBe(false);
    expect(requiresShellSender({ type: "select-work-file", path: "README.md" })).toBe(false);
    expect(requiresShellSender({ type: "restart-work-runtime" })).toBe(false);
    expect(requiresShellSender({ type: "work-send", text: "Summarize this page" })).toBe(false);
  });
});
