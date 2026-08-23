import type { BrowserCommand } from "../shared/ipc.js";

const SHELL_ONLY_COMMANDS = new Set<BrowserCommand["type"]>([
  "complete-onboarding",
  "autofill-credential",
  "save-pending-credential",
  "dismiss-pending-credential",
  "delete-credential",
  "begin-sync-registration",
  "begin-sync-sign-in",
  "sync-now",
  "disconnect-sync",
  "delete-sync-cloud-data",
  "delete-sync-account",
]);

export function requiresShellSender(command: BrowserCommand): boolean {
  return SHELL_ONLY_COMMANDS.has(command.type);
}
