import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BrowserDatabase } from "./BrowserDatabase.js";
import { recoverInterruptedRecordings, recordingFileExtension } from "./RecordingRecovery.js";

describe("recording crash recovery", () => {
  it("detects MP4 and WebM media headers", () => {
    expect(recordingFileExtension(Buffer.from([0, 0, 0, 20, 102, 116, 121, 112]))).toBe("mp4");
    expect(recordingFileExtension(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))).toBe("webm");
  });

  it("marks open sessions interrupted and preserves permission-restricted partial video", () => {
    const root = mkdtempSync(join(tmpdir(), "locus-recording-recovery-"));
    const temporaryRoot = join(root, "temporary");
    const recoveryRoot = join(root, "recovered");
    const database = new BrowserDatabase(join(root, "browser.sqlite"));
    database.createRecordingSession({
      id: "recording-crash", profileId: "default", workSessionId: "work-1",
      startedAt: 1, status: "recording", engine: "local", sourcesJson: "{}", saveVideo: true,
    });
    // The fixture represents an MP4 ftyp header followed by a redacted media payload.
    mkdirSync(temporaryRoot, { recursive: true });
    writeFileSync(join(temporaryRoot, "recording-crash.partial"), Buffer.from([0, 0, 0, 20, 102, 116, 121, 112, 1, 2, 3]));

    const recovered = recoverInterruptedRecordings({ database, profileId: "default", temporaryRoot, recoveryRoot, now: 5_000 });
    expect(recovered[0]?.videoPath).toMatch(/recording-crash\.mp4$/);
    expect(readFileSync(recovered[0]!.videoPath!)).toHaveLength(11);
    expect(database.listRecordingSessions("default")[0]).toMatchObject({ status: "interrupted", endedAt: 5_000 });
    database.close();
  });
});
