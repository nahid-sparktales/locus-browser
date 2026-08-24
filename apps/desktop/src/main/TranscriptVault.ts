import { randomBytes, randomUUID } from "node:crypto";
import { decryptLocalValue, encryptLocalValue, type LocalEncryptedValue } from "@locus/sync-crypto";
import type { RecordingTranscriptSummary, TranscriptSegment } from "../shared/types.js";
import type { BrowserDatabase, StoredRecordingSegment } from "./BrowserDatabase.js";
import type { CredentialCipher } from "./CredentialVault.js";

export interface NewTranscriptSegment {
  recordingId: string;
  source: "tab" | "microphone";
  startMs: number;
  endMs: number;
  text: string;
  tabId?: string;
}

export class TranscriptVault {
  #key: string | undefined;

  constructor(
    readonly database: BrowserDatabase,
    readonly cipher: CredentialCipher,
    readonly profileId: string,
  ) {}

  available(): boolean {
    return this.cipher.available();
  }

  async add(segment: NewTranscriptSegment): Promise<TranscriptSegment> {
    if (!this.available()) throw new Error("OS-backed transcript encryption is unavailable");
    const id = randomUUID();
    const clean: TranscriptSegment = {
      id,
      recordingId: segment.recordingId,
      source: segment.source,
      startMs: Math.max(0, Math.round(segment.startMs)),
      endMs: Math.max(Math.round(segment.startMs), Math.round(segment.endMs)),
      text: segment.text.trim().slice(0, 4_000),
      ...(segment.tabId ? { tabId: segment.tabId } : {}),
    };
    if (!clean.text) throw new Error("Transcript segment cannot be empty");
    const encrypted = await encryptLocalValue(await this.#localKey(), segmentContext(clean), clean.text);
    this.database.saveRecordingSegment({
      id: clean.id,
      recordingId: clean.recordingId,
      source: clean.source,
      startMs: clean.startMs,
      endMs: clean.endMs,
      ...(clean.tabId ? { tabId: clean.tabId } : {}),
      nonce: encrypted.nonce,
      ciphertext: encrypted.ciphertext,
    });
    return clean;
  }

  async segments(recordingId: string): Promise<TranscriptSegment[]> {
    const key = await this.#localKey();
    const output: TranscriptSegment[] = [];
    for (const stored of this.database.recordingSegments(recordingId)) {
      const value: LocalEncryptedValue = { version: 1, nonce: stored.nonce, ciphertext: stored.ciphertext };
      output.push({
        id: stored.id,
        recordingId: stored.recordingId,
        source: stored.source,
        startMs: stored.startMs,
        endMs: stored.endMs,
        text: await decryptLocalValue(key, segmentContext(stored), value),
        ...(stored.tabId ? { tabId: stored.tabId } : {}),
      });
    }
    return output;
  }

  summaries(): RecordingTranscriptSummary[] {
    return this.database.listRecordingSessions(this.profileId).map((session) => {
      const segmentCount = this.database.recordingSegments(session.id).length;
      return {
        id: session.id,
        workSessionId: session.workSessionId,
        startedAt: session.startedAt,
        ...(session.endedAt ? { endedAt: session.endedAt } : {}),
        durationMs: Math.max(0, (session.endedAt ?? Date.now()) - session.startedAt),
        segmentCount,
        ...(session.videoPath ? { videoPath: session.videoPath } : {}),
      };
    });
  }

  delete(recordingId: string): void {
    this.database.deleteRecording(this.profileId, recordingId);
  }

  async #localKey(): Promise<string> {
    if (this.#key) return this.#key;
    const wrapped = this.database.recordingKey(this.profileId);
    if (wrapped) {
      this.#key = this.cipher.decrypt(wrapped);
      return this.#key;
    }
    const key = randomBytes(32).toString("base64url");
    this.database.saveRecordingKey(this.profileId, this.cipher.encrypt(key));
    this.#key = key;
    return key;
  }
}

function segmentContext(segment: Pick<StoredRecordingSegment, "id" | "recordingId" | "source" | "startMs" | "endMs">): string {
  return `recording:${segment.recordingId}:${segment.id}:${segment.source}:${segment.startMs}:${segment.endMs}`;
}
