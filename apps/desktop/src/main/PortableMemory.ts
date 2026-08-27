import type { WalrusMemoryResultState } from "../shared/types.js";

export const PORTABLE_MEMORY_HEADER = "locus-portable-memory-v1";
export const MAX_PORTABLE_MEMORY_CHARS = 24_000;
export const MAX_PORTABLE_MEMORY_NOTE_CHARS = 2_000;

export interface PortableMemoryDocument {
  type: "page" | "research-summary";
  title: string;
  sourceUrl: string;
  capturedAt: string;
  contentSha256: string;
  body: string;
}

export interface PortablePageCandidate {
  privateWindow: boolean;
  privateTab: boolean;
  protectedPage: boolean;
  shared: boolean;
  url: string;
  excludedOrigins: readonly string[];
}

export function portablePageEligibilityError(candidate: PortablePageCandidate): string | undefined {
  if (candidate.privateWindow || candidate.privateTab) return "Walrus Memory is unavailable in Private Windows";
  if (!candidate.shared) return "Share the current tab with this Work conversation before saving it to Walrus Memory";
  if (candidate.protectedPage) return "Only normal shared HTTP(S) pages can be saved to Walrus Memory";
  const url = eligiblePortableSourceUrl(candidate.url);
  if (!url) return "Only normal shared HTTP(S) pages can be saved to Walrus Memory";
  if (candidate.excludedOrigins.includes(new URL(url).origin)) {
    return "This site is excluded from private intelligence and cannot be saved to Walrus Memory";
  }
  return undefined;
}

export function eligiblePortableSourceUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function serializePortableMemory(document: PortableMemoryDocument): string {
  const header = [
    PORTABLE_MEMORY_HEADER,
    `type: ${cleanHeader(document.type, 40)}`,
    `title: ${cleanHeader(document.title, 2_048)}`,
    `source-url: ${cleanHeader(document.sourceUrl, 8_192)}`,
    `captured-at: ${cleanHeader(document.capturedAt, 64)}`,
    `content-sha256: ${cleanHeader(document.contentSha256.toLowerCase(), 64)}`,
    "---",
  ].join("\n");
  const available = Math.max(0, MAX_PORTABLE_MEMORY_CHARS - header.length - 1);
  return `${header}\n${document.body.slice(0, available)}`;
}

export function parsePortableMemory(blobId: string, text: string, distance: number): WalrusMemoryResultState {
  const delimiter = text.indexOf("\n---\n");
  if (!text.startsWith(`${PORTABLE_MEMORY_HEADER}\n`) || delimiter < 0) {
    const body = text.trim().slice(0, MAX_PORTABLE_MEMORY_CHARS);
    return {
      blobId,
      title: "Walrus Memory",
      text: body,
      snippet: compactSnippet(body),
      relevance: relevanceFromDistance(distance),
    };
  }
  const headers = new Map<string, string>();
  for (const line of text.slice(PORTABLE_MEMORY_HEADER.length + 1, delimiter).split("\n")) {
    const separator = line.indexOf(":");
    if (separator > 0) headers.set(line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1).trim());
  }
  const body = text.slice(delimiter + 5).trim().slice(0, MAX_PORTABLE_MEMORY_CHARS);
  const sourceUrl = safeSourceUrl(headers.get("source-url"));
  const capturedAt = safeIsoDate(headers.get("captured-at"));
  const contentSha256 = headers.get("content-sha256")?.toLowerCase();
  return {
    blobId,
    title: (headers.get("title") || "Walrus Memory").slice(0, 2_048),
    text: body,
    snippet: compactSnippet(body),
    relevance: relevanceFromDistance(distance),
    ...(sourceUrl ? { sourceUrl } : {}),
    ...(capturedAt ? { capturedAt } : {}),
    ...(contentSha256?.match(/^[a-f0-9]{64}$/) ? { contentSha256 } : {}),
  };
}

function cleanHeader(value: string, max: number): string {
  return value.replace(/[\r\n\0]+/g, " ").trim().slice(0, max);
}

function safeSourceUrl(value: string | undefined): string | undefined {
  return value ? eligiblePortableSourceUrl(value) : undefined;
}

function safeIsoDate(value: string | undefined): string | undefined {
  if (!value || Number.isNaN(Date.parse(value))) return undefined;
  return value.slice(0, 64);
}

function compactSnippet(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 320);
}

function relevanceFromDistance(distance: number): number {
  return Math.round(Math.max(0, Math.min(1, 1 - (Number.isFinite(distance) ? distance : 1))) * 1_000_000) / 1_000_000;
}
