import type { BrowserCommand } from "../shared/ipc.js";

const SHELL_ONLY_COMMANDS = new Set<BrowserCommand["type"]>([
  "complete-onboarding",
  "autofill-credential",
  "save-pending-credential",
  "dismiss-pending-credential",
  "delete-credential",
]);

export function requiresShellSender(command: BrowserCommand): boolean {
  return SHELL_ONLY_COMMANDS.has(command.type);
}
