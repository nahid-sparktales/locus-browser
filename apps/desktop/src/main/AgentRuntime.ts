import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { randomBytes } from "node:crypto";
import { accessSync, constants, existsSync, mkdirSync } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { EventEmitter } from "node:events";
import WebSocket from "ws";

export type AgentEvent = Record<string, unknown> & { type?: string };

export function shouldRefreshBrowserControl(event: AgentEvent): boolean {
  return event.type === "turn_done";
}

export class AgentRuntime extends EventEmitter {
  readonly #platformRoot: string;
  readonly #dataRoot: string;
  #process: ChildProcessByStdio<null, Readable, Readable> | undefined;
  #socket: WebSocket | undefined;
  #token = "";
  #baseUrl = "";
  #stopping = false;
  #generation = 0;
  #reportedOfflineGeneration = 0;

  constructor(platformRoot: string, dataRoot: string) {
    super();
    this.#platformRoot = platformRoot;
    this.#dataRoot = dataRoot;
  }

  async start(): Promise<void> {
    if (this.#process || this.#socket) return;
    this.#stopping = false;
    const generation = ++this.#generation;
    this.#reportedOfflineGeneration = 0;
    this.#token = randomBytes(32).toString("base64url");
    const port = await availablePort();
    this.#baseUrl = `http://127.0.0.1:${port}`;
    const packaged = existsSync(join(this.#platformRoot, "source", "ollama_code"));
    const agentRoot = packaged ? join(this.#platformRoot, "source") : join(this.#platformRoot, "agent");
    const python = packaged
      ? join(this.#platformRoot, "python", "bin", "python3")
      : this.#pythonExecutable(agentRoot);
    const pythonPath = packaged
      ? [agentRoot, join(this.#platformRoot, "site-packages")].join(":")
      : agentRoot;
    const managedEnvironment = managedChatGPTEnvironment(this.#platformRoot, this.#dataRoot, packaged);
    mkdirSync(this.#dataRoot, { recursive: true });
    this.emit("status", { status: "starting", message: "Starting the local agent…" });

    const child = spawn(python, ["-m", "ollama_code.server", "--port", String(port)], {
      cwd: agentRoot,
      env: {
        ...process.env,
        PYTHONPATH: pythonPath,
        ...(packaged ? { PYTHONDONTWRITEBYTECODE: "1" } : {}),
        ...managedEnvironment,
        LOCUS_AGENT_TOKEN: this.#token,
        OLLAMA_CODE_HOME: this.#dataRoot,
        PYTHONUNBUFFERED: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.#process = child;
    child.stdout.on("data", (chunk: Buffer) => this.emit("log", chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => this.emit("log", chunk.toString()));
    child.once("exit", (code) => {
      if (generation !== this.#generation) return;
      this.#process = undefined;
      this.#socket = undefined;
      this.#emitOffline(generation, `Local agent stopped (${code ?? "signal"})`);
    });

    try {
      await this.#waitForHealth(port);
      if (generation !== this.#generation) return;
      await this.#connect(port, generation);
    } catch (error) {
      if (generation === this.#generation) {
        this.#emitOffline(generation, error instanceof Error ? error.message : "The local agent did not start");
        this.stop();
      }
    }
  }

  async restart(): Promise<void> {
    this.stop();
    await this.start();
  }

  send(message: Record<string, unknown>): boolean {
    if (this.#socket?.readyState !== WebSocket.OPEN) return false;
    this.#socket.send(JSON.stringify(message));
    return true;
  }

  async listSessions(): Promise<unknown> {
    return await this.#requestJson("/api/sessions?limit=100");
  }

  async newSession(cwd = ""): Promise<unknown> {
    return await this.#requestJson("/api/sessions/new", {
      method: "POST",
      body: JSON.stringify({ reason: "new_session", ...(cwd ? { cwd } : {}) }),
    });
  }

  async setWorkspace(cwd: string): Promise<unknown> {
    return await this.#requestJson("/api/config", {
      method: "POST",
      body: JSON.stringify({ cwd }),
    });
  }

  async setModel(model: string): Promise<unknown> {
    return await this.#requestJson("/api/config", {
      method: "POST",
      body: JSON.stringify({ model }),
    });
  }

  async provider(): Promise<unknown> {
    return await this.#requestJson("/api/provider");
  }

  async configureProvider(value: Record<string, unknown>): Promise<unknown> {
    return await this.#requestJson("/api/provider", {
      method: "POST",
      body: JSON.stringify(value),
    });
  }

  async models(): Promise<unknown> {
    return await this.#requestJson("/api/models");
  }

  async localModels(): Promise<unknown> {
    const response = await fetch("http://127.0.0.1:11434/api/tags", { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new Error(`Local model service failed (${response.status})`);
    return await response.json();
  }

  async chatGPTAccount(refresh = false): Promise<unknown> {
    return await this.#requestJson(`/api/chatgpt/account${refresh ? "?refresh=true" : ""}`);
  }

  async chatGPTModels(): Promise<unknown> {
    return await this.#requestJson("/api/chatgpt/models");
  }

  async chatGPTUsage(): Promise<unknown> {
    return await this.#requestJson("/api/chatgpt/usage");
  }

  async startChatGPTLogin(): Promise<unknown> {
    return await this.#requestJson("/api/chatgpt/login/start", { method: "POST", body: "{}" });
  }

  async signOutChatGPT(): Promise<unknown> {
    return await this.#requestJson("/api/chatgpt/logout", { method: "POST", body: "{}" });
  }

  async session(sessionId: string): Promise<unknown> {
    return await this.#requestJson(`/api/sessions/${encodeURIComponent(sessionId)}`);
  }

  async resumeSession(sessionId: string): Promise<unknown> {
    return await this.#requestJson(`/api/sessions/${encodeURIComponent(sessionId)}/resume`, {
      method: "POST",
      body: "{}",
    });
  }

  async gitStatus(): Promise<unknown> {
    return await this.#requestJson("/api/git/status?untracked=all");
  }

  async gitDiff(path: string, staged = false): Promise<unknown> {
    const query = new URLSearchParams({ path, context: "3", max_bytes: "200000" });
    if (staged) query.set("staged", "true");
    return await this.#requestJson(`/api/git/diff?${query.toString()}`);
  }

  stop(): void {
    this.#generation += 1;
    this.#stopping = true;
    this.#socket?.close();
    this.#socket = undefined;
    this.#process?.kill("SIGTERM");
    this.#process = undefined;
    this.#baseUrl = "";
    this.#token = "";
  }

  async #requestJson(path: string, init: RequestInit = {}): Promise<unknown> {
    if (!this.#baseUrl || !this.#token) throw new Error("The local agent is offline");
    const response = await fetch(`${this.#baseUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "X-Locus-Token": this.#token,
        ...init.headers,
      },
    });
    const value = await response.json().catch(() => undefined) as Record<string, unknown> | undefined;
    if (!response.ok) {
      const detail = value?.detail ?? value?.message;
      throw new Error(typeof detail === "string" && detail ? detail : `Local agent request failed (${response.status})`);
    }
    return value;
  }

  #pythonExecutable(agentRoot: string): string {
    const candidates = [
      process.env.LOCUS_AGENT_PYTHON,
      join(agentRoot, ".venv", "bin", "python"),
      process.env.PYTHON,
      "python3",
    ].filter((value): value is string => Boolean(value));
    for (const candidate of candidates) {
      if (!candidate.includes("/")) return candidate;
      try {
        accessSync(resolve(candidate), constants.X_OK);
        return resolve(candidate);
      } catch {
        // Try the next configured interpreter.
      }
    }
    throw new Error("No Python interpreter is available for the Locus agent runtime");
  }

  async #waitForHealth(port: number): Promise<void> {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      if (this.#process?.exitCode !== null && this.#process?.exitCode !== undefined) {
        throw new Error("The local agent exited during startup");
      }
      try {
        const response = await fetch(`${this.#baseUrl}/api/health`, {
          headers: { "X-Locus-Token": this.#token },
        });
        if (response.ok) return;
      } catch {
        // Startup polling is intentionally quiet.
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 150));
    }
    throw new Error("The local agent did not answer within 20 seconds");
  }

  async #connect(port: number, generation: number): Promise<void> {
    await new Promise<void>((resolvePromise, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/ws/chat`, {
        headers: { "X-Locus-Token": this.#token },
      });
      this.#socket = socket;
      socket.once("open", () => {
        if (generation !== this.#generation) {
          socket.close();
          return;
        }
        socket.send(JSON.stringify({ type: "set_browser_control", enabled: true }));
        this.#reportedOfflineGeneration = 0;
        this.emit("status", { status: "online", message: "Local agent ready" });
        resolvePromise();
      });
      socket.once("error", (error) => generation === this.#generation ? reject(error) : resolvePromise());
      socket.on("message", (data) => {
        if (generation !== this.#generation) return;
        try {
          const event = JSON.parse(data.toString()) as AgentEvent;
          this.emit("event", event);
          if (shouldRefreshBrowserControl(event) && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: "set_browser_control", enabled: true }));
          }
        } catch {
          this.emit("log", "Ignored malformed local-agent event");
        }
      });
      socket.on("close", () => {
        if (generation !== this.#generation) return;
        this.#socket = undefined;
        this.#emitOffline(generation, "Local agent disconnected");
      });
    });
  }

  #emitOffline(generation: number, message: string): void {
    if (generation !== this.#generation || this.#stopping || this.#reportedOfflineGeneration === generation) return;
    this.#reportedOfflineGeneration = generation;
    this.emit("status", { status: "offline", message });
  }
}

export function managedChatGPTEnvironment(
  platformRoot: string,
  dataRoot: string,
  packaged: boolean,
): Record<string, string> {
  if (!packaged) return {};
  return {
    LOCUS_CODEX_APP_SERVER_PATH: join(platformRoot, "components", "codex-app-server", "codex"),
    LOCUS_CODEX_HOME: join(dataRoot, "chatgpt-plan"),
  };
}

async function availablePort(): Promise<number> {
  return await new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not reserve a loopback port"));
        return;
      }
      const port = address.port;
      server.close((error) => error ? reject(error) : resolvePromise(port));
    });
  });
}
