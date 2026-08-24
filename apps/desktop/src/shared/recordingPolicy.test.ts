import { describe, expect, it } from "vitest";
import { canAcceptRecordedMedia, preferredRecordingMimeType, scaleRedactionRects } from "./recordingPolicy.js";

describe("recording media policy", () => {
  it("prefers MP4 and falls back to a supported WebM format", () => {
    expect(preferredRecordingMimeType(() => true)).toContain("video/mp4");
    expect(preferredRecordingMimeType((value) => value.includes("vp8"))).toBe("video/webm;codecs=vp8,opus");
    expect(preferredRecordingMimeType(() => false)).toBe("video/webm");
  });

  it("scales and clips protected rectangles before canvas drawing", () => {
    expect(scaleRedactionRects(
      [{ x: 80, y: 20, width: 40, height: 40 }],
      { width: 100, height: 100 },
      { width: 200, height: 100 },
    )).toEqual([{ x: 160, y: 20, width: 40, height: 40 }]);
  });

  it("rejects media immediately after revocation or stale redaction state", () => {
    const base = { status: "recording", capturing: true, redactionsAt: 1_000, now: 1_500 };
    expect(canAcceptRecordedMedia({ ...base, targetMatches: true })).toBe(true);
    expect(canAcceptRecordedMedia({ ...base, targetMatches: false })).toBe(false);
    expect(canAcceptRecordedMedia({ ...base, targetMatches: true, now: 2_001 })).toBe(false);
  });
});
