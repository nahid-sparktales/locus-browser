import type { BrowserCommand } from "../shared/ipc.js";

export type StateSurface = "shell" | "work";
export type StatePublicationScope = StateSurface | "both";

const workOnlyCommands = new Set<BrowserCommand["type"]>([
  "set-work-mode",
  "set-work-panel",
  "choose-workspace",
  "request-work-plan",
  "approve-work-plan",
  "revise-work-plan",
  "refresh-work-changes",
  "select-work-change",
  "refresh-work-files",
  "select-work-file",
  "clear-work-terminal",
  "choose-work-attachments",
  "remove-work-attachment",
]);

export function publicationScopeForCommand(command: BrowserCommand): StatePublicationScope {
  return workOnlyCommands.has(command.type) ? "work" : "both";
}

/** Coalesces synchronous state changes into one publication per renderer surface. */
export class SurfaceStatePublisher {
  readonly #publish: (surfaces: ReadonlySet<StateSurface>) => void;
  readonly #pending = new Set<StateSurface>();
  #scheduled = false;

  constructor(publish: (surfaces: ReadonlySet<StateSurface>) => void) {
    this.#publish = publish;
  }

  request(scope: StatePublicationScope = "both"): void {
    if (scope === "both" || scope === "shell") this.#pending.add("shell");
    if (scope === "both" || scope === "work") this.#pending.add("work");
    if (this.#scheduled) return;
    this.#scheduled = true;
    queueMicrotask(() => this.flush());
  }

  flush(): void {
    if (!this.#scheduled) return;
    this.#scheduled = false;
    const surfaces = new Set(this.#pending);
    this.#pending.clear();
    this.#publish(surfaces);
  }
}
