import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { randomBytes } from "node:crypto";
import { accessSync, constants, mkdirSync } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { EventEmitter } from "node:events";
import WebSocket from "ws";

export type AgentEvent = Record<string, unknown> & { type?: string };

export class AgentRuntime extends EventEmitter {
  readonly #platformRoot: string;
  readonly #dataRoot: string;
  #process: ChildProcessByStdio<null, Readable, Readable> | undefined;
  #socket: WebSocket | undefined;
  #token = "";
  #baseUrl = "";
  #stopping = false;

  constructor(platformRoot: string, dataRoot: string) {
    super();
    this.#platformRoot = platformRoot;
    this.#dataRoot = dataRoot;
  }

  async start(): Promise<void> {
    if (this.#process || this.#socket) return;
    this.#stopping = false;
    this.#token = randomBytes(32).toString("base64url");
    const port = await availablePort();
    this.#baseUrl = `http://127.0.0.1:${port}`;
    const agentRoot = join(this.#platformRoot, "agent");
    const python = this.#pythonExecutable(agentRoot);
    mkdirSync(this.#dataRoot, { recursive: true });
    this.emit("status", { status: "starting", message: "Starting the local agent…" });

    const child = spawn(python, ["-m", "ollama_code.server", "--port", String(port)], {
      cwd: agentRoot,
      env: {
        ...process.env,
        PYTHONPATH: agentRoot,
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
      this.#process = undefined;
      this.#socket = undefined;
      if (!this.#stopping) {
        this.emit("status", { status: "offline", message: `Local agent stopped (${code ?? "signal"})` });
      }
    });

    try {
      await this.#waitForHealth(port);
      await this.#connect(port);
    } catch (error) {
      this.emit("status", {
        status: "offline",
        message: error instanceof Error ? error.message : "The local agent did not start",
      });
      this.stop();
    }
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

  async session(sessionId: string): Promise<unknown> {
    return await this.#requestJson(`/api/sessions/${encodeURIComponent(sessionId)}`);
  }

  async resumeSession(sessionId: string): Promise<unknown> {
    return await this.#requestJson(`/api/sessions/${encodeURIComponent(sessionId)}/resume`, {
      method: "POST",
      body: "{}",
    });
  }

  stop(): void {
    this.#stopping = true;
    this.#socket?.close();
    this.#socket = undefined;
    this.#process?.kill("SIGTERM");
    this.#process = undefined;
    this.#baseUrl = "";
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

  async #connect(port: number): Promise<void> {
    await new Promise<void>((resolvePromise, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/ws/chat`, {
        headers: { "X-Locus-Token": this.#token },
      });
      this.#socket = socket;
      socket.once("open", () => {
        socket.send(JSON.stringify({ type: "set_browser_control", enabled: true }));
        this.emit("status", { status: "online", message: "Local agent ready" });
        resolvePromise();
      });
      socket.once("error", reject);
      socket.on("message", (data) => {
        try {
          this.emit("event", JSON.parse(data.toString()) as AgentEvent);
        } catch {
          this.emit("log", "Ignored malformed local-agent event");
        }
      });
      socket.on("close", () => {
        this.#socket = undefined;
        if (!this.#stopping) this.emit("status", { status: "offline", message: "Local agent disconnected" });
      });
    });
  }
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
