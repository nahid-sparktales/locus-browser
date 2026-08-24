import { describe, expect, it } from "vitest";
import type { TranscriptSegment } from "../shared/types.js";
import { selectTranscriptSegments } from "./RecordingCoordinator.js";

describe("recording observation context", () => {
  it("keeps recent speech and query-relevant earlier segments within the text budget", () => {
    const segments: TranscriptSegment[] = Array.from({ length: 120 }, (_, index) => ({
      id: `segment-${index}`,
      recordingId: "recording-1",
      source: index % 2 ? "microphone" : "tab",
      startMs: index * 1_000,
      endMs: index * 1_000 + 900,
      text: index === 4 ? "The special invoice total is available here" : `ordinary segment ${index} ${"x".repeat(250)}`,
    }));
    const selected = selectTranscriptSegments(segments, "special invoice");
    expect(selected.some((segment) => segment.id === "segment-4")).toBe(true);
    expect(selected.at(-1)?.id).toBe("segment-119");
    expect(selected.reduce((total, segment) => total + segment.text.length, 0)).toBeLessThanOrEqual(24_000);
  });
});
