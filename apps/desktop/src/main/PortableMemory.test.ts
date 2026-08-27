import { describe, expect, it } from "vitest";
import {
  MAX_PORTABLE_MEMORY_CHARS,
  PORTABLE_MEMORY_HEADER,
  parsePortableMemory,
  portablePageEligibilityError,
  serializePortableMemory,
} from "./PortableMemory.js";

describe("portable Walrus memory format", () => {
  it("rejects private, unshared, protected, local, credential-bearing, and excluded pages", () => {
    const eligible = {
      privateWindow: false, privateTab: false, protectedPage: false, shared: true,
      url: "https://example.com/report", excludedOrigins: [] as string[],
    };
    expect(portablePageEligibilityError(eligible)).toBeUndefined();
    expect(portablePageEligibilityError({ ...eligible, privateWindow: true })).toMatch(/Private Windows/);
    expect(portablePageEligibilityError({ ...eligible, privateTab: true })).toMatch(/Private Windows/);
    expect(portablePageEligibilityError({ ...eligible, shared: false })).toMatch(/Share the current tab/);
    expect(portablePageEligibilityError({ ...eligible, protectedPage: true })).toMatch(/HTTP\(S\)/);
    expect(portablePageEligibilityError({ ...eligible, url: "file:///tmp/private.html" })).toMatch(/HTTP\(S\)/);
    expect(portablePageEligibilityError({ ...eligible, url: "https://user:secret@example.com/report" })).toMatch(/HTTP\(S\)/);
    expect(portablePageEligibilityError({ ...eligible, excludedOrigins: ["https://example.com"] })).toMatch(/excluded/);
  });

  it("serializes a stable bounded header and preserves parsed provenance", () => {
    const serialized = serializePortableMemory({
      type: "page",
      title: "Example\nInjected: header",
      sourceUrl: "https://example.com/report",
      capturedAt: "2026-08-26T12:00:00.000Z",
      contentSha256: "a".repeat(64),
      body: "A useful finding.\n\nUser note\nReview this later.",
    });
    expect(serialized.startsWith(`${PORTABLE_MEMORY_HEADER}\n`)).toBe(true);
    expect(serialized).not.toContain("Example\nInjected");
    const parsed = parsePortableMemory("blob-1", serialized, 0.18);
    expect(parsed).toMatchObject({
      blobId: "blob-1",
      title: "Example Injected: header",
      sourceUrl: "https://example.com/report",
      capturedAt: "2026-08-26T12:00:00.000Z",
      contentSha256: "a".repeat(64),
      relevance: 0.82,
    });
    expect(parsed.text).toContain("A useful finding");
  });

  it("caps the complete stored item at 24,000 characters", () => {
    const serialized = serializePortableMemory({
      type: "research-summary",
      title: "Large research summary",
      sourceUrl: "https://example.com",
      capturedAt: "2026-08-26T12:00:00.000Z",
      contentSha256: "b".repeat(64),
      body: "x".repeat(40_000),
    });
    expect(serialized).toHaveLength(MAX_PORTABLE_MEMORY_CHARS);
  });

  it("treats non-Locus memories as plain remote evidence without invented provenance", () => {
    expect(parsePortableMemory("blob-external", "A memory from another app", 0.4)).toEqual({
      blobId: "blob-external",
      title: "Walrus Memory",
      text: "A memory from another app",
      snippet: "A memory from another app",
      relevance: 0.6,
    });
  });
});
