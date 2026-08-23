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
    { type: "begin-sync-registration", displayName: "Personal", serviceUrl: "https://sync.example.com" },
    { type: "begin-sync-sign-in", recoveryKey: "LOCUS-AAAAA-BBBBB-CCCCC-DDDDD-EEEEE-FFFFF-GGGGG-HHHHH", serviceUrl: "https://sync.example.com" },
    { type: "sync-now" },
    { type: "disconnect-sync" },
    { type: "delete-sync-cloud-data" },
    { type: "delete-sync-account" },
  ])("keeps $type on the trusted browser-chrome sender", (command) => {
    expect(requiresShellSender(command)).toBe(true);
  });

  it("allows ordinary browser and Work commands through their existing sender policy", () => {
    expect(requiresShellSender({ type: "toggle-work" })).toBe(false);
    expect(requiresShellSender({ type: "work-send", text: "Summarize this page" })).toBe(false);
  });
});
