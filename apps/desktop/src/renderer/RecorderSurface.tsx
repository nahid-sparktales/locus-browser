import { useEffect, useRef, useState } from "react";
import { preferredRecordingMimeType, scaleRedactionRects } from "../shared/recordingPolicy.js";

interface RecorderStart {
  type: "start" | "restart";
  sessionId: string;
  sources: { tabAudio: boolean; microphone: boolean };
  saveVideo: boolean;
  redactions: Omit<RedactionUpdate, "type">;
}

interface RedactionUpdate {
  type: "redactions";
  viewport: { width: number; height: number };
  rects: Array<{ x: number; y: number; width: number; height: number }>;
  pausedReason?: string;
}

type RecorderCommand = RecorderStart | RedactionUpdate | { type: "suspend"; reason: string } | { type: "stop" };

export function RecorderSurface() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const recorder = useRef<LiveRecorder | undefined>(undefined);
  const [label, setLabel] = useState("Recorder ready");

  useEffect(() => {
    window.locusRecorder.send({ type: "ready" });
    let queue = Promise.resolve();
    return window.locusRecorder.subscribe((raw) => {
      const command = raw as RecorderCommand;
      if (command.type === "start" || command.type === "restart") {
        setLabel("Capturing shared tab");
        queue = queue.then(async () => {
          const active = recorder.current;
          const next = active && active.sessionId === command.sessionId
            ? active
            : new LiveRecorder(canvasRef.current!, command);
          if (active && active !== next) await active.stop(false);
          recorder.current = next;
          await (active === next ? next.restart(command) : next.start()).then(() => window.locusRecorder.send({ type: "started" })).catch((error) => {
            setLabel("Capture unavailable");
            window.locusRecorder.send({ type: "error", message: error instanceof Error ? error.message : "Capture unavailable" });
          });
        });
      } else if (command.type === "redactions") {
        recorder.current?.setRedactions(command);
        setLabel(command.pausedReason || "Capturing shared tab");
      } else if (command.type === "suspend") {
        setLabel(command.reason);
        queue = queue.then(async () => {
          await recorder.current?.suspend(command.reason);
          window.locusRecorder.send({ type: "suspended" });
        });
      } else if (command.type === "stop") {
        setLabel("Stopping…");
        queue = queue.then(async () => {
          await recorder.current?.stop(true);
          recorder.current = undefined;
          setLabel("Recorder ready");
        });
      }
    });
  }, []);

  return <main className="recorder-surface"><canvas ref={canvasRef} width={1280} height={720} /><span>{label}</span></main>;
}

class LiveRecorder {
  readonly video = document.createElement("video");
  readonly audio = new AudioContext({ latencyHint: "interactive" });
  readonly mix = this.audio.createMediaStreamDestination();
  readonly audioCaptures: AudioCapture[] = [];
  displayStream: MediaStream | undefined;
  microphoneStream: MediaStream | undefined;
  mediaRecorder: MediaRecorder | undefined;
  videoChunkWrites: Promise<void>[] = [];
  redactions: RedactionUpdate;
  frameTimer: number | undefined;
  drawFrame = 0;
  startedAt = performance.now();

  command: RecorderStart;

  constructor(readonly canvas: HTMLCanvasElement, command: RecorderStart) {
    this.command = command;
    this.redactions = { type: "redactions", ...command.redactions };
  }

  get sessionId(): string { return this.command.sessionId; }

  async start(): Promise<void> {
    await this.startCapture();
    this.resizeCanvas();
    this.render();
    if (this.command.saveVideo) this.startVideoRecording();
  }

  async restart(command: RecorderStart): Promise<void> {
    await this.stopCapture(true);
    this.command = command;
    this.redactions = { type: "redactions", ...command.redactions };
    await this.startCapture();
    this.resizeCanvas();
  }

  async suspend(reason: string): Promise<void> {
    this.redactions = { ...this.redactions, pausedReason: reason };
    await this.stopCapture(true);
  }

  private async startCapture(): Promise<void> {
    this.displayStream = await navigator.mediaDevices.getDisplayMedia({
      video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: this.command.saveVideo ? 30 : 8 } },
      audio: this.command.sources.tabAudio,
    });
    this.video.muted = true;
    this.video.srcObject = this.displayStream;
    await this.video.play();
    if (this.command.sources.microphone) {
      this.microphoneStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
    }
    this.attachAudio(this.displayStream, "tab");
    if (this.microphoneStream) this.attachAudio(this.microphoneStream, "microphone");
  }

  setRedactions(update: RedactionUpdate): void { this.redactions = update; }

  async stop(notify: boolean): Promise<void> {
    if (this.frameTimer) window.clearInterval(this.frameTimer);
    window.cancelAnimationFrame(this.drawFrame);
    await this.stopCapture(true);
    if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
      await new Promise<void>((resolve) => {
        this.mediaRecorder!.addEventListener("stop", () => resolve(), { once: true });
        this.mediaRecorder!.stop();
      });
      await Promise.all(this.videoChunkWrites.splice(0));
    }
    await this.audio.close().catch(() => undefined);
    if (notify) window.locusRecorder.send({ type: "stopped" });
  }

  private async stopCapture(flush: boolean): Promise<void> {
    for (const capture of this.audioCaptures.splice(0)) capture.dispose(flush);
    for (const stream of [this.displayStream, this.microphoneStream]) stream?.getTracks().forEach((track) => track.stop());
    this.displayStream = undefined;
    this.microphoneStream = undefined;
    this.video.srcObject = null;
  }

  private resizeCanvas(): void {
    const width = Math.max(this.video.videoWidth, 1);
    const height = Math.max(this.video.videoHeight, 1);
    const scale = Math.min(1, 1920 / width, 1080 / height);
    this.canvas.width = Math.max(1, Math.round(width * scale));
    this.canvas.height = Math.max(1, Math.round(height * scale));
  }

  private render = (): void => {
    const context = this.canvas.getContext("2d", { alpha: false })!;
    context.fillStyle = "#121512";
    context.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (this.redactions.pausedReason) {
      context.fillStyle = "#c7fb45";
      context.font = "600 26px system-ui";
      context.textAlign = "center";
      context.fillText("Locus capture paused", this.canvas.width / 2, this.canvas.height / 2 - 8);
      context.fillStyle = "#e7eadf";
      context.font = "16px system-ui";
      context.fillText(this.redactions.pausedReason, this.canvas.width / 2, this.canvas.height / 2 + 24);
    } else if (this.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      context.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
      const scaled = scaleRedactionRects(this.redactions.rects, this.redactions.viewport, this.canvas);
      for (const rect of scaled) {
        context.fillStyle = "#636861";
        context.fillRect(rect.x, rect.y, rect.width, rect.height);
        context.fillStyle = "#f4f5ee";
        context.font = "12px system-ui";
        context.textAlign = "center";
        context.fillText("Protected", rect.x + rect.width / 2, rect.y + rect.height / 2);
      }
    }
    this.drawFrame = window.requestAnimationFrame(this.render);
    if (!this.frameTimer) {
      this.frameTimer = window.setInterval(() => {
        const data = this.canvas.toDataURL("image/jpeg", 0.72).split(",")[1];
        if (data) window.locusRecorder.send({ type: "frame", capturedAt: new Date().toISOString(), data });
      }, 2_000);
    }
  };

  private attachAudio(stream: MediaStream, source: "tab" | "microphone"): void {
    if (!stream.getAudioTracks().length) return;
    const mediaSource = this.audio.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
    const capture = new AudioCapture(this.audio, mediaSource, source, this.startedAt);
    this.audioCaptures.push(capture);
    mediaSource.connect(this.mix);
  }

  private startVideoRecording(): void {
    const stream = this.canvas.captureStream(30);
    for (const track of this.mix.stream.getAudioTracks()) stream.addTrack(track);
    const mimeType = preferredRecordingMimeType((choice) => MediaRecorder.isTypeSupported(choice));
    this.mediaRecorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 4_000_000 });
    this.mediaRecorder.ondataavailable = (event) => {
      if (!event.data.size) return;
      const pending = event.data.arrayBuffer().then((data) => {
        window.locusRecorder.send({ type: "video-chunk", mimeType, data: new Uint8Array(data) });
      });
      this.videoChunkWrites.push(pending);
      void pending.finally(() => {
        const index = this.videoChunkWrites.indexOf(pending);
        if (index >= 0) this.videoChunkWrites.splice(index, 1);
      });
    };
    this.mediaRecorder.start(2_000);
  }
}

class AudioCapture {
  readonly processor: ScriptProcessorNode;
  readonly silent: GainNode;
  chunks: Float32Array[] = [];
  samples = 0;
  energy = 0;
  chunkStartedAt: number;

  constructor(readonly audio: AudioContext, readonly sourceNode: MediaStreamAudioSourceNode, readonly source: "tab" | "microphone", readonly sessionStartedAt: number) {
    this.chunkStartedAt = performance.now();
    this.processor = audio.createScriptProcessor(4096, 1, 1);
    this.silent = audio.createGain();
    this.silent.gain.value = 0;
    sourceNode.connect(this.processor);
    this.processor.connect(this.silent).connect(audio.destination);
    this.processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      const copy = new Float32Array(input);
      this.chunks.push(copy);
      this.samples += copy.length;
      for (const sample of copy) this.energy += sample * sample;
      if (this.samples >= audio.sampleRate * 5) this.flush(false);
    };
  }

  flush(force: boolean): void {
    if (!this.samples) return;
    const rms = Math.sqrt(this.energy / this.samples);
    const end = performance.now();
    if ((force || rms >= 0.008) && rms >= 0.004) {
      const merged = mergeSamples(this.chunks, this.samples);
      const downsampled = downsample(merged, this.audio.sampleRate, 16_000);
      const wav = encodeWav(downsampled, 16_000);
      window.locusRecorder.send({
        type: "audio", source: this.source,
        startMs: Math.max(0, Math.round(this.chunkStartedAt - this.sessionStartedAt)),
        endMs: Math.max(0, Math.round(end - this.sessionStartedAt)),
        data: wav,
      });
    }
    this.chunks = [];
    this.samples = 0;
    this.energy = 0;
    this.chunkStartedAt = end;
  }

  dispose(flush: boolean): void {
    this.flush(flush);
    this.processor.disconnect();
    this.silent.disconnect();
    this.sourceNode.disconnect();
  }
}

function mergeSamples(chunks: Float32Array[], total: number): Float32Array {
  const output = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
  return output;
}

function downsample(input: Float32Array, inputRate: number, outputRate: number): Float32Array {
  if (inputRate === outputRate) return input;
  const ratio = inputRate / outputRate;
  const output = new Float32Array(Math.max(1, Math.round(input.length / ratio)));
  for (let index = 0; index < output.length; index += 1) {
    const start = Math.floor(index * ratio);
    const end = Math.min(input.length, Math.floor((index + 1) * ratio));
    let sum = 0;
    for (let cursor = start; cursor < end; cursor += 1) sum += input[cursor]!;
    output[index] = sum / Math.max(end - start, 1);
  }
  return output;
}

function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) => [...value].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
  text(0, "RIFF"); view.setUint32(4, 36 + samples.length * 2, true); text(8, "WAVE"); text(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, "data"); view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, index) => view.setInt16(44 + index * 2, Math.max(-1, Math.min(1, sample)) * 0x7fff, true));
  return new Uint8Array(buffer);
}
