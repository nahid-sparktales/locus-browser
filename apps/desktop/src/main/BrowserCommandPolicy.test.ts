import { describe, expect, it } from "vitest";
import type { BrowserCommand } from "../shared/ipc.js";
import { requiresShellSender, requiresWorkSender } from "./BrowserCommandPolicy.js";

describe("browser command sender policy", () => {
  it.each<BrowserCommand>([
    { type: "open-settings" },
    { type: "close-settings" },
    { type: "set-accent-color", preset: "purple", customHex: "4A90FF" },
    { type: "set-local-models-enabled", enabled: true },
    { type: "set-semantic-recall-enabled", enabled: true },
    { type: "clear-semantic-recall" },
    { type: "delete-recall-document", documentId: "recall-1" },
    { type: "connect-walrus-memory", accountId: "0xabc", namespace: "locus-browser-v1" },
    { type: "disconnect-walrus-memory" },
    { type: "manage-walrus-delegates" },
    { type: "begin-walrus-page-memory" },
    { type: "begin-walrus-research-memory", boardId: "board-1" },
    { type: "cancel-walrus-memory-draft" },
    { type: "save-walrus-memory-draft", draftId: "00000000-0000-4000-8000-000000000000", note: "Review later" },
    { type: "restore-walrus-memory" },
    { type: "configure-walrus-client-encrypted", network: "testnet", packageId: "0xabc", registryId: "0xdef", embeddingApiBase: "https://api.openai.com/v1", embeddingModel: "text-embedding-3-small" },
    { type: "set-walrus-memory-mode", mode: "client-encrypted" },
    { type: "generate-research-board", tabIds: ["tab-1"], prompt: "Compare", format: "comparison" },
    { type: "export-research-board", boardId: "board-1", format: "pdf" },
    { type: "prepare-walrus-research-bundle", boardId: "board-1", visibility: "public", includePassages: false, epochs: 5 },
    { type: "publish-walrus-research-bundle", draftId: "00000000-0000-4000-8000-000000000000" },
    { type: "cancel-walrus-research-bundle" },
    { type: "apply-tab-steward", suggestionIds: ["suggestion-1"] },
    { type: "save-resume-bundle", name: "Later", tabIds: ["tab-1"], closeAfter: false },
    { type: "execute-palette-action", action: { type: "toggle-split" } },
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
    { type: "configure-speech", engine: "local", language: "auto" },
    { type: "download-speech-model" },
    { type: "test-work-provider-credential", providerId: "kimi" },
    { type: "remove-work-provider-credential", providerId: "kimi" },
    { type: "start-recording", shareLevel: "read", tabAudio: true, microphone: true, saveVideo: false },
    { type: "pause-recording" },
    { type: "resume-recording" },
    { type: "stop-recording" },
    { type: "set-recording-source", source: "microphone", enabled: false },
    { type: "delete-recording-transcript", recordingId: "00000000-0000-4000-8000-000000000000" },
    { type: "reveal-recording-video", recordingId: "00000000-0000-4000-8000-000000000000" },
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

  it.each<BrowserCommand>([
    { type: "open-walrus-memory-source", blobId: "blob-1" },
    { type: "attach-walrus-memory", blobIds: ["blob-1"] },
    { type: "remove-walrus-memory-attachment", blobId: "blob-1" },
  ])("keeps $type on the trusted Work sender", (command) => {
    expect(requiresShellSender(command)).toBe(false);
    expect(requiresWorkSender(command)).toBe(true);
  });
});
