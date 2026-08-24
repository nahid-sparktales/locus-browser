import { createHash } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Writable } from "node:stream";
import { z } from "zod";
import type { SpeechEngine, SpeechSettings } from "../shared/types.js";
import type { BrowserDatabase } from "./BrowserDatabase.js";
import type { CredentialCipher } from "./CredentialVault.js";

const SpeechStoredSettingsSchema = z.object({
  engine: z.enum(["local", "openai", "custom"]).default("local"),
  language: z.string().min(2).max(16).default("auto"),
  customBaseUrl: z.string().max(2_048).optional(),
  customModel: z.string().max(255).optional(),
  encryptedCustomApiKey: z.string().max(64_000).optional(),
});
type StoredSpeechSettings = z.infer<typeof SpeechStoredSettingsSchema>;

const SpeechManifestSchema = z.object({
  version: z.string(),
  models: z.array(z.object({
    id: z.string(), name: z.string(), url: z.string().url(), sha256: z.string().length(64),
    size: z.number().int().positive(), file: z.string().min(1),
  })).min(1),
});
type SpeechModelManifest = z.infer<typeof SpeechManifestSchema>;
const SETTINGS_KEY = "speechSettingsV1";

export class SpeechSettingsStore {
  #settings: StoredSpeechSettings;

  constructor(readonly database: BrowserDatabase, readonly cipher: CredentialCipher, readonly profileId: string) {
    const parsed = SpeechStoredSettingsSchema.safeParse(database.setting(profileId, SETTINGS_KEY));
    this.#settings = parsed.success ? parsed.data : { engine: "local", language: "auto" };
  }

  value(localModelStatus: SpeechSettings["localModelStatus"], localModelProgress?: number, message?: string): SpeechSettings {
    return {
      engine: this.#settings.engine,
      language: this.#settings.language,
      ...(this.#settings.customBaseUrl ? { customBaseUrl: this.#settings.customBaseUrl } : {}),
      ...(this.#settings.customModel ? { customModel: this.#settings.customModel } : {}),
      localModelStatus,
      ...(typeof localModelProgress === "number" ? { localModelProgress } : {}),
      ...(message ? { message } : {}),
    };
  }

  engine(): SpeechEngine { return this.#settings.engine; }
  language(): string { return this.#settings.language; }
  customBaseUrl(): string { return this.#settings.customBaseUrl ?? ""; }
  customModel(): string { return this.#settings.customModel || "whisper-1"; }

  customApiKey(): string {
    if (!this.#settings.encryptedCustomApiKey) return "";
    if (!this.cipher.available()) throw new Error("OS-backed speech-key encryption is unavailable");
    return this.cipher.decrypt(Buffer.from(this.#settings.encryptedCustomApiKey, "base64"));
  }

  save(value: { engine: SpeechEngine; language: string; baseUrl?: string; model?: string; apiKey?: string }): void {
    let encryptedCustomApiKey = this.#settings.encryptedCustomApiKey;
    if (value.apiKey !== undefined) {
      encryptedCustomApiKey = value.apiKey
        ? Buffer.from(this.cipher.encrypt(value.apiKey)).toString("base64")
        : undefined;
    }
    const customBaseUrl = value.engine === "custom" ? validateSpeechEndpoint(value.baseUrl || this.customBaseUrl()).toString().replace(/\/$/, "") : this.#settings.customBaseUrl;
    this.#settings = {
      engine: value.engine,
      language: value.language || "auto",
      ...(customBaseUrl ? { customBaseUrl } : {}),
      ...(value.model || this.#settings.customModel ? { customModel: value.model || this.#settings.customModel } : {}),
      ...(encryptedCustomApiKey ? { encryptedCustomApiKey } : {}),
    };
    this.database.setSetting(this.profileId, SETTINGS_KEY, this.#settings);
  }
}

export class SpeechRuntime {
  readonly #manifest: SpeechModelManifest;
  readonly #modelRoot: string;
  #downloading = false;
  #downloadProgress = 0;
  #message = "";

  constructor(readonly platformRoot: string, userDataRoot: string) {
    this.#manifest = SpeechManifestSchema.parse(JSON.parse(readFileSync(manifestPath(platformRoot), "utf8")));
    this.#modelRoot = join(userDataRoot, "Speech Models");
    mkdirSync(this.#modelRoot, { recursive: true });
  }

  state(): Pick<SpeechSettings, "localModelStatus" | "localModelProgress" | "message"> {
    if (this.#downloading) return { localModelStatus: "downloading", localModelProgress: this.#downloadProgress, message: "Downloading the private speech model…" };
    if (this.localModelReady()) return { localModelStatus: "ready", message: "On-device transcription is ready" };
    return { localModelStatus: this.#message ? "error" : "missing", ...(this.#message ? { message: this.#message } : {}) };
  }

  localModelReady(): boolean {
    const model = this.#manifest.models[0]!;
    const path = join(this.#modelRoot, model.file);
    if (!existsSync(path) || statSync(path).size !== model.size) return false;
    return fileSha256(path) === model.sha256;
  }

  async downloadModel(onProgress: () => void): Promise<void> {
    if (this.#downloading || this.localModelReady()) return;
    this.#downloading = true;
    this.#message = "";
    this.#downloadProgress = 0;
    onProgress();
    const model = this.#manifest.models[0]!;
    const target = join(this.#modelRoot, model.file);
    const temporary = `${target}.${randomUUID()}.download`;
    try {
      const response = await fetch(model.url, { redirect: "follow", signal: AbortSignal.timeout(120_000) });
      if (!response.ok || !response.body) throw new Error(`Speech model download failed (${response.status})`);
      const stream = createWriteStream(temporary, { mode: 0o600, flags: "wx" });
      let received = 0;
      try {
        for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
          received += chunk.byteLength;
          if (received > model.size) throw new Error("Speech model exceeded its pinned size");
          if (!stream.write(chunk)) await new Promise<void>((resolve, reject) => { stream.once("drain", resolve); stream.once("error", reject); });
          this.#downloadProgress = Math.min(received / model.size, 1);
          onProgress();
        }
      } finally {
        await new Promise<void>((resolve) => stream.end(resolve));
      }
      if (received !== model.size || fileSha256(temporary) !== model.sha256) throw new Error("Speech model verification failed");
      renameSync(temporary, target);
      this.#downloadProgress = 1;
    } catch (error) {
      if (existsSync(temporary)) unlinkSync(temporary);
      this.#message = error instanceof Error ? error.message : "Speech model download failed";
      throw error;
    } finally {
      this.#downloading = false;
      onProgress();
    }
  }

  async transcribeLocal(wav: Uint8Array, language = "auto"): Promise<string> {
    if (!this.localModelReady()) throw new Error("Download the on-device speech model first");
    const executable = whisperExecutable(this.platformRoot);
    if (!executable) throw new Error("The signed on-device speech component is unavailable");
    const model = join(this.#modelRoot, this.#manifest.models[0]!.file);
    const output = await runWithEphemeralAudio(
      executable,
      ["--model", model, "--file", "/dev/fd/3", "--no-prints", "--no-timestamps", "--language", language],
      wav,
      45_000,
    );
    return output.trim();
  }
}

export async function transcribeCloud(options: { baseUrl: string; apiKey: string; model: string; wav: Uint8Array; language: string }): Promise<string> {
  const base = validateSpeechEndpoint(options.baseUrl);
  const endpoint = new URL(base.pathname.endsWith("/audio/transcriptions") ? base.pathname : `${base.pathname.replace(/\/$/, "")}/audio/transcriptions`, base);
  const body = new FormData();
  body.set("file", new Blob([Buffer.from(options.wav)], { type: "audio/wav" }), "locus-live-context.wav");
  body.set("model", options.model || "gpt-4o-mini-transcribe");
  if (options.language !== "auto") body.set("language", options.language);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {},
    body,
    redirect: "manual",
    signal: AbortSignal.timeout(45_000),
  });
  if (response.status >= 300 && response.status < 400) throw new Error("Speech endpoint redirects are not allowed");
  if (!response.ok) throw new Error(`Speech transcription failed (${response.status})`);
  const result = await response.json() as { text?: unknown };
  if (typeof result.text !== "string") throw new Error("Speech endpoint returned a malformed transcript");
  return result.text.trim();
}

export function validateSpeechEndpoint(raw: string): URL {
  const value = raw.trim().replace(/\/$/, "");
  const url = new URL(value);
  if (url.username || url.password) throw new Error("Speech endpoint URLs cannot contain credentials");
  if (url.search || url.hash) throw new Error("Speech endpoint URLs cannot contain query parameters or fragments");
  const loopback = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error("Speech endpoints require HTTPS, except for this Mac");
  }
  return url;
}

function manifestPath(platformRoot: string): string {
  const packaged = join(platformRoot, "components", "whisper", "manifest.json");
  if (existsSync(packaged)) return packaged;
  return join(platformRoot, "agent", "ollama_code", "runtime_components", "whisper-cpp.json");
}

function whisperExecutable(platformRoot: string): string | undefined {
  const packaged = join(platformRoot, "components", "whisper", "whisper-cli");
  if (existsSync(packaged)) return packaged;
  const candidates = (process.env.PATH || "").split(":").map((directory) => join(directory, "whisper-cli"));
  return candidates.find((candidate) => existsSync(candidate));
}

function fileSha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function runWithEphemeralAudio(executable: string, arguments_: string[], audio: Uint8Array, timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, arguments_, { stdio: ["ignore", "pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(stdout);
    };
    const append = (target: "stdout" | "stderr", chunk: Buffer) => {
      if (target === "stdout") stdout += chunk.toString();
      else stderr += chunk.toString();
      if (stdout.length + stderr.length > 2 * 1024 * 1024) {
        child.kill("SIGKILL");
        finish(new Error("The speech component returned too much output"));
      }
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error("On-device transcription timed out"));
    }, timeout);
    child.stdout!.on("data", (chunk: Buffer) => append("stdout", chunk));
    child.stderr!.on("data", (chunk: Buffer) => append("stderr", chunk));
    child.once("error", (error) => finish(error));
    child.once("close", (code) => finish(code === 0 ? undefined : new Error(stderr.trim() || `Speech component stopped (${code ?? "signal"})`)));
    const input = child.stdio[3] as Writable | null;
    if (!input) {
      child.kill("SIGKILL");
      finish(new Error("The speech component audio channel is unavailable"));
      return;
    }
    input.once("error", (error) => finish(error));
    input.end(Buffer.from(audio));
  });
}
