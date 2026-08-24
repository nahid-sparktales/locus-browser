import { chmodSync, closeSync, copyFileSync, existsSync, mkdirSync, openSync, readSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { BrowserDatabase } from "./BrowserDatabase.js";

export interface RecoveredRecording {
  id: string;
  videoPath?: string;
}

export function recoverInterruptedRecordings(options: {
  database: BrowserDatabase;
  profileId: string;
  temporaryRoot: string;
  recoveryRoot: string;
  now?: number;
}): RecoveredRecording[] {
  const output: RecoveredRecording[] = [];
  const now = options.now ?? Date.now();
  for (const session of options.database.listRecordingSessions(options.profileId, 500)) {
    if (session.status !== "recording") continue;
    const temporary = join(options.temporaryRoot, `${session.id}.partial`);
    let videoPath: string | undefined;
    if (session.saveVideo && existsSync(temporary) && statSync(temporary).size > 0) {
      mkdirSync(options.recoveryRoot, { recursive: true, mode: 0o700 });
      const extension = recordingFileExtension(readHeader(temporary));
      videoPath = join(options.recoveryRoot, `${session.id}.${extension}`);
      copyFileSync(temporary, videoPath);
      chmodSync(videoPath, 0o600);
      unlinkSync(temporary);
    }
    options.database.finishRecordingSession(session.id, "interrupted", now, videoPath);
    output.push({ id: session.id, ...(videoPath ? { videoPath } : {}) });
  }
  return output;
}

export function recordingFileExtension(header: Uint8Array): "mp4" | "webm" {
  if (header.length >= 8 && Buffer.from(header.subarray(4, 8)).toString("ascii") === "ftyp") return "mp4";
  return "webm";
}

function readHeader(path: string): Uint8Array {
  const descriptor = openSync(path, "r");
  const header = Buffer.alloc(16);
  try {
    const bytes = readSync(descriptor, header, 0, header.length, 0);
    return header.subarray(0, bytes);
  } finally {
    closeSync(descriptor);
  }
}
