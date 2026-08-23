import { describe, expect, it } from "vitest";
import {
  MAX_WORK_ATTACHMENT_BYTES,
  attachmentBudgetIssue,
  detectImageMimeType,
} from "./WorkAttachmentPolicy.js";

describe("work attachment policy", () => {
  it("recognizes supported image content from signatures rather than filenames", () => {
    expect(detectImageMimeType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    expect(detectImageMimeType(Uint8Array.from([0xff, 0xd8, 0xff, 0x00]))).toBe("image/jpeg");
    expect(detectImageMimeType(Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toBe("image/gif");
    expect(detectImageMimeType(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))).toBe("image/webp");
    expect(detectImageMimeType(Uint8Array.from([0x25, 0x50, 0x44, 0x46]))).toBeUndefined();
  });

  it("mirrors the local runtime count and byte budgets", () => {
    expect(attachmentBudgetIssue(Array(9).fill(1), [1])).toBeUndefined();
    expect(attachmentBudgetIssue(Array(10).fill(1), [1])).toContain("up to 10");
    expect(attachmentBudgetIssue([], [MAX_WORK_ATTACHMENT_BYTES + 1])).toContain("15 MB");
    expect(attachmentBudgetIssue([13 * 1024 * 1024], [13 * 1024 * 1024])).toContain("25 MB");
  });
});
