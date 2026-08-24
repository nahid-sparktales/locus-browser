export interface RecordingRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function preferredRecordingMimeType(isSupported: (mimeType: string) => boolean): string {
  return [
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
  ].find(isSupported) || "video/webm";
}

export function scaleRedactionRects(
  rects: RecordingRect[],
  viewport: { width: number; height: number },
  canvas: { width: number; height: number },
): RecordingRect[] {
  const scaleX = canvas.width / Math.max(viewport.width, 1);
  const scaleY = canvas.height / Math.max(viewport.height, 1);
  return rects.map((rect) => ({
    x: Math.max(0, rect.x * scaleX),
    y: Math.max(0, rect.y * scaleY),
    width: Math.max(0, Math.min(canvas.width, (rect.x + rect.width) * scaleX) - Math.max(0, rect.x * scaleX)),
    height: Math.max(0, Math.min(canvas.height, (rect.y + rect.height) * scaleY) - Math.max(0, rect.y * scaleY)),
  })).filter((rect) => rect.width > 0 && rect.height > 0);
}

export function canAcceptRecordedMedia(value: {
  status: string;
  capturing: boolean;
  redactionsAt: number;
  now: number;
  targetMatches: boolean;
}): boolean {
  return value.status === "recording"
    && value.capturing
    && value.targetMatches
    && value.now - value.redactionsAt <= 1_000;
}
