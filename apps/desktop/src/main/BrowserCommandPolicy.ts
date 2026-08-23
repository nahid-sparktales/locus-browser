import type { BrowserCommand } from "../shared/ipc.js";

const SHELL_ONLY_COMMANDS = new Set<BrowserCommand["type"]>([
  "complete-onboarding",
  "autofill-credential",
  "save-pending-credential",
  "dismiss-pending-credential",
  "delete-credential",
  "set-extension-developer-mode",
  "install-unpacked-extension",
  "set-extension-enabled",
  "remove-extension",
  "begin-sync-registration",
  "begin-sync-sign-in",
  "begin-sync-device-enrollment",
  "check-sync-device-enrollment",
  "cancel-sync-device-enrollment",
  "copy-sync-pairing-code",
  "approve-sync-device",
  "revoke-sync-device",
  "rotate-sync-recovery-key",
  "sync-now",
  "disconnect-sync",
  "delete-sync-cloud-data",
  "delete-sync-account",
]);

export function requiresShellSender(command: BrowserCommand): boolean {
  return SHELL_ONLY_COMMANDS.has(command.type);
}
