import { createHash, randomUUID } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { chmod, copyFile, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { BrowserWindow, app, dialog, type WebContents } from "electron";
import { z } from "zod";
import type {
  BrowserObservationContext,
  RecordingSessionState,
  RecordingSourceState,
  TranscriptSegment,
} from "../shared/types.js";
import { ipcChannels } from "../shared/channels.js";
import type { BrowserDatabase } from "./BrowserDatabase.js";
import { SpeechRuntime, SpeechSettingsStore, transcribeCloud } from "./SpeechRuntime.js";
import type { TranscriptVault } from "./TranscriptVault.js";
import { canAcceptRecordedMedia } from "../shared/recordingPolicy.js";
import { recoverInterruptedRecordings } from "./RecordingRecovery.js";

const RecorderMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ready") }),
  z.object({ type: z.literal("started") }),
  z.object({ type: z.literal("suspended") }),
  z.object({ type: z.literal("stopped") }),
  z.object({
    type: z.literal("frame"), capturedAt: z.string().datetime(),
    data: z.string().min(1).max(4_000_000),
  }),
  z.object({
    type: z.literal("audio"), source: z.enum(["tab", "microphone"]),
    startMs: z.number().int().nonnegative(), endMs: z.number().int().nonnegative(),
    data: z.instanceof(Uint8Array),
  }),
  z.object({
    type: z.literal("video-chunk"), mimeType: z.string().min(1).max(128),
    data: z.instanceof(Uint8Array),
  }),
  z.object({ type: z.literal("error"), message: z.string().max(2_000) }),
]);

export interface RecordingCaptureTarget {
  tabId: string;
  title: string;
  url: string;
  accessLevel: "read" | "interact";
  webContents: WebContents;
  protectedRects: () => Promise<{
    url: string;
    viewport: { width: number; height: number };
    rects: Array<{ x: number; y: number; width: number; height: number }>;
  }>;
}

export interface RecordingTargetResult {
  target?: RecordingCaptureTarget;
  reason?: string;
}

interface ObservationFrame {
  captured_at: string;
  mime_type: "image/jpeg";
  data: string;
  description: string;
  hash: string;
}

export interface RecordingCoordinatorOptions {
  rendererUrl: string;
  preloadPath: string;
  parent: BrowserWindow;
  database: BrowserDatabase;
  profileId: string;
  transcriptVault: TranscriptVault;
  speechSettings: SpeechSettingsStore;
  speechRuntime: SpeechRuntime;
  getWorkSessionId: () => string;
  getTarget: () => RecordingTargetResult;
  openAIKey: () => string;
  onChanged: () => void;
}

export class RecordingCoordinator {
  static #active: RecordingCoordinator | undefined;
  static readonly #recoveredProfiles = new Set<string>();

  readonly #sources: RecordingSourceState = { tabAudio: true, microphone: true };
  #status: RecordingSessionState["status"] = "idle";
  #id: string | undefined;
  #startedAt: number | undefined;
  #saveVideo = false;
  #manualPause = false;
  #pausedReason: string | undefined;
  #error: string | undefined;
  #target: RecordingCaptureTarget | undefined;
  #capturing = false;
  #redactionsAt = 0;
  #preview: TranscriptSegment[] = [];
  #frames: ObservationFrame[] = [];
  #recorder: BrowserWindow | undefined;
  #recorderReady = false;
  #readyWaiters: Array<() => void> = [];
  #refreshTimer: NodeJS.Timeout | undefined;
  #refreshing = false;
  #speechQueue = Promise.resolve();
  #stopWaiter: (() => void) | undefined;
  #videoStream: ReturnType<typeof createWriteStream> | undefined;
  #videoTemporaryPath: string | undefined;
  #videoMimeType = "video/webm";
  #disposed = false;

  constructor(readonly options: RecordingCoordinatorOptions) {
    if (!RecordingCoordinator.#recoveredProfiles.has(options.profileId)) {
      recoverInterruptedRecordings({
        database: options.database,
        profileId: options.profileId,
        temporaryRoot: recordingTemporaryRoot(),
        recoveryRoot: join(app.getPath("userData"), "Recovered Recordings", options.profileId),
      });
      RecordingCoordinator.#recoveredProfiles.add(options.profileId);
    }
  }

  ownsSender(senderId: number): boolean {
    return this.#recorder?.webContents.id === senderId;
  }

  state(): RecordingSessionState {
    return {
      status: this.#status,
      ...(this.#id ? { id: this.#id } : {}),
      ...(this.#startedAt ? { startedAt: this.#startedAt } : {}),
      elapsedMs: this.#startedAt ? Math.max(0, Date.now() - this.#startedAt) : 0,
      sources: { ...this.#sources },
      saveVideo: this.#saveVideo,
      ...(this.#target ? { activeTabId: this.#target.tabId } : {}),
      ...(this.#pausedReason ? { pausedReason: this.#pausedReason } : {}),
      transcriptPreview: [...this.#preview],
      transcripts: this.options.transcriptVault.summaries(),
      engine: this.options.speechSettings.engine(),
      ...(this.#error ? { error: this.#error } : {}),
    };
  }

  async start(value: { tabAudio: boolean; microphone: boolean; saveVideo: boolean }): Promise<void> {
    if (this.#status !== "idle") return;
    if (RecordingCoordinator.#active && RecordingCoordinator.#active !== this) {
      throw new Error("Another Locus recording is already active");
    }
    const initial = this.options.getTarget();
    if (!initial.target) throw new Error(initial.reason || "Share this tab before recording");
    const redactions = await this.#loadRedactions(initial.target);
    this.#sources.tabAudio = value.tabAudio;
    this.#sources.microphone = value.microphone;
    this.#saveVideo = value.saveVideo;
    this.#manualPause = false;
    this.#pausedReason = undefined;
    this.#error = undefined;
    this.#frames = [];
    this.#preview = [];
    this.#id = randomUUID();
    this.#startedAt = Date.now();
    this.#status = "starting";
    this.#target = initial.target;
    this.#redactionsAt = Date.now();
    RecordingCoordinator.#active = this;
    const recordingId = this.#id;
    let persisted = false;
    try {
      this.options.database.createRecordingSession({
        id: recordingId,
        profileId: this.options.profileId,
        workSessionId: this.options.getWorkSessionId(),
        startedAt: this.#startedAt,
        status: "recording",
        engine: this.options.speechSettings.engine(),
        sourcesJson: JSON.stringify(this.#sources),
        saveVideo: this.#saveVideo,
      });
      persisted = true;
      if (this.#saveVideo) this.#openVideoStream();
      await this.#ensureRecorder();
      this.#send({
        type: "start", sessionId: recordingId, sources: this.#sources, saveVideo: this.#saveVideo,
        redactions,
      });
      this.#refreshTimer = setInterval(() => void this.refreshTarget(), 350);
      this.options.onChanged();
    } catch (error) {
      clearInterval(this.#refreshTimer);
      this.#refreshTimer = undefined;
      this.#send({ type: "suspend", reason: "Recording could not start" });
      this.#videoStream?.destroy();
      this.#videoStream = undefined;
      const temporary = this.#videoTemporaryPath;
      this.#videoTemporaryPath = undefined;
      if (temporary) await unlink(temporary).catch(() => undefined);
      if (persisted) this.options.database.finishRecordingSession(recordingId, "interrupted", Date.now());
      this.#status = "idle";
      this.#id = undefined;
      this.#startedAt = undefined;
      this.#target = undefined;
      this.#capturing = false;
      this.#redactionsAt = 0;
      this.#error = error instanceof Error ? error.message : "Recording could not start";
      if (RecordingCoordinator.#active === this) RecordingCoordinator.#active = undefined;
      this.options.onChanged();
      throw error;
    }
  }

  async pause(reason = "Paused by you"): Promise<void> {
    if (!this.#id || this.#status === "idle") return;
    this.#manualPause = true;
    await this.#suspend(reason);
  }

  async resume(): Promise<void> {
    if (!this.#id || this.#status === "idle") return;
    this.#manualPause = false;
    this.#error = undefined;
    await this.refreshTarget(true);
  }

  async setSource(source: keyof RecordingSourceState, enabled: boolean): Promise<void> {
    this.#sources[source] = enabled;
    if (this.#id && !this.#manualPause) {
      this.#capturing = false;
      await this.refreshTarget(true);
    }
    this.options.onChanged();
  }

  async stop(): Promise<void> {
    if (!this.#id || this.#status === "idle" || this.#status === "stopping") return;
    this.#status = "stopping";
    clearInterval(this.#refreshTimer);
    this.#refreshTimer = undefined;
    this.options.onChanged();
    if (this.#recorder && !this.#recorder.webContents.isDestroyed()) {
      const stopped = new Promise<void>((resolve) => { this.#stopWaiter = resolve; });
      this.#send({ type: "stop" });
      await Promise.race([stopped, new Promise<void>((resolve) => setTimeout(resolve, 4_000))]);
    }
    const videoPath = await this.#finishVideo();
    this.options.database.finishRecordingSession(this.#id, "completed", Date.now(), videoPath);
    this.#status = "idle";
    this.#id = undefined;
    this.#startedAt = undefined;
    this.#target = undefined;
    this.#capturing = false;
    this.#pausedReason = undefined;
    this.#frames = [];
    this.#stopWaiter = undefined;
    if (RecordingCoordinator.#active === this) RecordingCoordinator.#active = undefined;
    this.options.onChanged();
  }

  async refreshTarget(forceRestart = false): Promise<void> {
    if (!this.#id || this.#manualPause || this.#status === "stopping" || this.#refreshing) return;
    this.#refreshing = true;
    try {
      const result = this.options.getTarget();
      if (!result.target) {
        await this.#suspend(result.reason || "Capture paused on this tab", false);
        return;
      }
      let redactions: { viewport: { width: number; height: number }; rects: Array<{ x: number; y: number; width: number; height: number }> };
      try {
        redactions = await this.#loadRedactions(result.target);
      } catch {
        await this.#suspend("Capture paused while privacy masks refresh", false);
        return;
      }
      const changed = this.#target?.tabId !== result.target.tabId
        || this.#target?.webContents.id !== result.target.webContents.id;
      this.#target = result.target;
      this.#pausedReason = undefined;
      this.#redactionsAt = Date.now();
      if (!this.#capturing || changed || forceRestart) {
        this.#status = "starting";
        this.#send({
          type: "restart", sessionId: this.#id, sources: this.#sources,
          saveVideo: this.#saveVideo, redactions,
        });
      } else {
        this.#send({ type: "redactions", ...redactions });
      }
      this.options.onChanged();
    } finally {
      this.#refreshing = false;
    }
  }

  handleRendererMessage(raw: unknown): void {
    const parsed = RecorderMessageSchema.safeParse(raw);
    if (!parsed.success || this.#disposed) return;
    const message = parsed.data;
    if (message.type === "ready") {
      this.#recorderReady = true;
      for (const resolve of this.#readyWaiters.splice(0)) resolve();
      return;
    }
    if (message.type === "started") {
      if (!this.#id || this.#status !== "starting") return;
      this.#capturing = true;
      this.#status = "recording";
      this.#pausedReason = undefined;
      this.options.onChanged();
      return;
    }
    if (message.type === "suspended") {
      this.#capturing = false;
      return;
    }
    if (message.type === "stopped") {
      this.#capturing = false;
      this.#stopWaiter?.();
      return;
    }
    if (message.type === "error") {
      this.#capturing = false;
      this.#status = "error";
      this.#error = message.message;
      this.#pausedReason = "Capture stopped because of an error";
      this.options.onChanged();
      return;
    }
    if (message.type === "video-chunk") {
      const acceptable = this.#status === "stopping" || (this.#status === "recording" && this.#acceptMediaMessage());
      if (this.#saveVideo && this.#videoStream && acceptable) {
        this.#videoMimeType = message.mimeType;
        this.#videoStream.write(Buffer.from(message.data));
      }
      return;
    }
    if (!this.#acceptMediaMessage()) return;
    if (message.type === "frame") this.#acceptFrame(message.capturedAt, message.data);
    else if (message.type === "audio") {
      if ((message.source === "tab" && !this.#sources.tabAudio) || (message.source === "microphone" && !this.#sources.microphone)) return;
      const tabId = this.#target?.tabId;
      this.#speechQueue = this.#speechQueue
        .then(() => this.#transcribe(message, tabId))
        .catch((error) => this.#speechGap(error, message, tabId));
    }
  }

  async observationContext(query: string, pageText: string, includeFrames: boolean): Promise<BrowserObservationContext | undefined> {
    if (!this.#id || !this.#startedAt) return undefined;
    const all = await this.options.transcriptVault.segments(this.#id);
    const transcript = selectTranscriptSegments(all, query).map((segment) => ({
      source: segment.source,
      start_ms: segment.startMs,
      end_ms: segment.endMs,
      text: segment.text,
      ...(segment.tabId ? { tab_id: segment.tabId } : {}),
    }));
    const target = this.options.getTarget().target;
    return {
      recording_id: this.#id,
      captured_at: new Date().toISOString(),
      ...(target ? {
        active_tab: { id: target.tabId, title: target.title, url: target.url, access_level: target.accessLevel },
      } : {}),
      transcript,
      ...(pageText ? { page_text: pageText.slice(0, 12_000) } : {}),
      frames: includeFrames ? this.#frames.slice(-4).map(({ hash: _hash, ...frame }) => frame) : [],
      ...(!target ? { paused_reason: this.#pausedReason || "The active tab is not shared" } : {}),
    };
  }

  deleteTranscript(recordingId: string): void {
    if (recordingId === this.#id) throw new Error("Stop this recording before deleting its transcript");
    this.options.transcriptVault.delete(recordingId);
    this.options.onChanged();
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    if (this.#id) {
      const id = this.#id;
      await this.stop().catch(() => this.options.database.finishRecordingSession(id, "interrupted", Date.now()));
    }
    this.#disposed = true;
    clearInterval(this.#refreshTimer);
    if (this.#recorder && !this.#recorder.isDestroyed()) this.#recorder.destroy();
    this.#recorder = undefined;
  }

  async #ensureRecorder(): Promise<void> {
    if (!this.#recorder || this.#recorder.isDestroyed()) {
      const recorderSession = ElectronSessionForRecorder(this.options.profileId);
      this.#recorder = new BrowserWindow({
        parent: this.options.parent,
        show: false,
        width: 1280,
        height: 720,
        skipTaskbar: true,
        webPreferences: {
          preload: this.options.preloadPath,
          nodeIntegration: false,
          sandbox: true,
          contextIsolation: true,
          webSecurity: true,
          partition: recorderSession.partition,
        },
      });
      const contents = this.#recorder.webContents;
      contents.setWindowOpenHandler(() => ({ action: "deny" }));
      const allowedSurface = new URL(recorderSurfaceUrl(this.options.rendererUrl));
      contents.on("will-navigate", (event, url) => {
        const next = new URL(url);
        if (next.protocol !== allowedSurface.protocol || next.host !== allowedSurface.host || next.pathname !== allowedSurface.pathname || next.searchParams.get("surface") !== "recorder") event.preventDefault();
      });
      const ses = contents.session;
      ses.setDisplayMediaRequestHandler((request, callback) => {
        const target = this.options.getTarget().target;
        const trusted = request.frame === contents.mainFrame;
        if (!trusted || !target || target.tabId !== this.#target?.tabId) return callback({});
        callback({
          video: target.webContents.mainFrame,
          ...(request.audioRequested && this.#sources.tabAudio ? { audio: target.webContents.mainFrame, enableLocalEcho: true } : {}),
        });
      }, { useSystemPicker: false });
      ses.setPermissionCheckHandler((webContents, permission) => webContents?.id === contents.id && ["media", "microphone"].includes(permission));
      ses.setPermissionRequestHandler((webContents, permission, callback) => callback(webContents.id === contents.id && ["media", "microphone"].includes(permission)));
      this.#recorderReady = false;
      await contents.loadURL(recorderSurfaceUrl(this.options.rendererUrl));
    }
    if (!this.#recorderReady) {
      await Promise.race([
        new Promise<void>((resolve) => this.#readyWaiters.push(resolve)),
        new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("Recorder surface did not start")), 5_000)),
      ]);
    }
  }

  async #loadRedactions(target: RecordingCaptureTarget) {
    const value = await target.protectedRects();
    if (value.url !== target.webContents.getURL()) throw new Error("Page changed during privacy masking");
    return { viewport: value.viewport, rects: value.rects };
  }

  async #suspend(reason: string, manual = true): Promise<void> {
    if (!this.#id) return;
    if (manual) this.#manualPause = true;
    this.#pausedReason = reason;
    this.#status = "paused";
    this.#target = undefined;
    this.#redactionsAt = 0;
    this.#send({ type: "suspend", reason });
    this.#capturing = false;
    this.options.onChanged();
  }

  #acceptMediaMessage(): boolean {
    if (!this.#id) return false;
    const current = this.options.getTarget().target;
    const target = this.#target;
    const targetMatches = Boolean(current && target
      && current.tabId === target.tabId
      && current.webContents.id === target.webContents.id
      && current.url === target.url);
    return canAcceptRecordedMedia({
      status: this.#status,
      capturing: this.#capturing,
      redactionsAt: this.#redactionsAt,
      now: Date.now(),
      targetMatches,
    });
  }

  #acceptFrame(capturedAt: string, data: string): void {
    const hash = createHash("sha256").update(data).digest("hex");
    if (this.#frames.at(-1)?.hash === hash) return;
    this.#frames.push({ captured_at: capturedAt, mime_type: "image/jpeg", data, description: "Redacted shared-tab frame", hash });
    while (this.#frames.length > 4 || this.#frames.reduce((size, frame) => size + frame.data.length, 0) > 10_000_000) this.#frames.shift();
  }

  async #transcribe(message: Extract<z.infer<typeof RecorderMessageSchema>, { type: "audio" }>, tabId: string | undefined): Promise<void> {
    if (!this.#id) return;
    const engine = this.options.speechSettings.engine();
    let text = "";
    if (engine === "local") {
      text = await this.options.speechRuntime.transcribeLocal(message.data, this.options.speechSettings.language());
    } else if (engine === "openai") {
      text = await transcribeCloud({
        baseUrl: "https://api.openai.com/v1", apiKey: this.options.openAIKey(),
        model: "gpt-4o-mini-transcribe", wav: message.data,
        language: this.options.speechSettings.language(),
      });
    } else {
      text = await transcribeCloud({
        baseUrl: this.options.speechSettings.customBaseUrl(), apiKey: this.options.speechSettings.customApiKey(),
        model: this.options.speechSettings.customModel(), wav: message.data,
        language: this.options.speechSettings.language(),
      });
    }
    if (!text.trim() || !this.#id) return;
    const segment = await this.options.transcriptVault.add({
      recordingId: this.#id, source: message.source,
      startMs: message.startMs, endMs: message.endMs, text, ...(tabId ? { tabId } : {}),
    });
    this.#preview = [...this.#preview, segment].slice(-12);
    this.#error = undefined;
    this.options.onChanged();
  }

  async #speechGap(
    error: unknown,
    source: { source: "tab" | "microphone"; startMs: number; endMs: number },
    tabId: string | undefined,
  ): Promise<void> {
    const message = error instanceof Error ? error.message : "Speech transcription failed";
    this.#error = `${message}. No audio was saved. You can switch Speech to On-device in Settings.`;
    if (this.#id && this.options.transcriptVault.available()) {
      try {
        const gap = await this.options.transcriptVault.add({
          recordingId: this.#id,
          source: source.source,
          startMs: source.startMs,
          endMs: source.endMs,
          text: "[Transcription gap — source audio was not retained]",
          ...(tabId ? { tabId } : {}),
        });
        this.#preview = [...this.#preview, gap].slice(-12);
      } catch {
        // The visible error still records the gap if encrypted storage becomes unavailable.
      }
    }
    this.options.onChanged();
  }

  #openVideoStream(): void {
    const directory = recordingTemporaryRoot();
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.#videoTemporaryPath = join(directory, `${this.#id}.partial`);
    this.#videoStream = createWriteStream(this.#videoTemporaryPath, { flags: "wx", mode: 0o600 });
  }

  async #finishVideo(): Promise<string | undefined> {
    const stream = this.#videoStream;
    const temporary = this.#videoTemporaryPath;
    this.#videoStream = undefined;
    this.#videoTemporaryPath = undefined;
    if (!stream || !temporary) return undefined;
    await new Promise<void>((resolve) => stream.end(resolve));
    if (!existsSync(temporary) || (await stat(temporary)).size === 0) {
      if (existsSync(temporary)) await unlink(temporary);
      return undefined;
    }
    const extension = this.#videoMimeType.includes("mp4") ? "mp4" : "webm";
    const result = await dialog.showSaveDialog(this.options.parent, {
      title: "Save redacted Locus recording",
      defaultPath: join(app.getPath("videos"), `Locus Recording ${new Date().toISOString().slice(0, 10)}.${extension}`),
      filters: [{ name: extension === "mp4" ? "MP4 Video" : "WebM Video", extensions: [extension] }],
    });
    if (result.canceled || !result.filePath) {
      await unlink(temporary);
      return undefined;
    }
    await copyFile(temporary, result.filePath);
    await chmod(result.filePath, 0o600);
    await unlink(temporary);
    return result.filePath;
  }

  #send(message: unknown): void {
    if (this.#recorder && !this.#recorder.webContents.isDestroyed()) this.#recorder.webContents.send(ipcChannels.recorderEvent, message);
  }
}

function ElectronSessionForRecorder(profileId: string): { partition: string } {
  return { partition: `locus-recorder-${profileId}` };
}

function recorderSurfaceUrl(rendererUrl: string): string {
  const url = new URL(rendererUrl);
  url.searchParams.set("surface", "recorder");
  return url.toString();
}

function recordingTemporaryRoot(): string {
  return join(app.getPath("temp"), "Locus Browser Recordings");
}

export function selectTranscriptSegments(segments: TranscriptSegment[], query: string): TranscriptSegment[] {
  const recent = segments.slice(-80);
  const recentIds = new Set(recent.map((segment) => segment.id));
  const terms = new Set(query.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []);
  const relevant = terms.size
    ? segments.slice(0, -80).filter((segment) => [...terms].some((term) => segment.text.toLowerCase().includes(term))).slice(-40)
    : [];
  const selected = [...relevant.filter((segment) => !recentIds.has(segment.id)), ...recent].slice(-120);
  let characters = 0;
  const bounded: TranscriptSegment[] = [];
  for (const segment of selected.reverse()) {
    if (characters + segment.text.length > 24_000) break;
    characters += segment.text.length;
    bounded.push(segment);
  }
  return bounded.reverse();
}
