import { createHash } from "node:crypto";
import type { ResearchBoardState, ResearchBundleDraftState } from "../shared/types.js";
import type { WalrusBundleSourceFile } from "../shared/walrusPrivate.js";
import { canonicalJson } from "../shared/canonicalJson.js";

export interface ResearchBundleOptions {
  visibility: "public" | "seal-encrypted";
  includePassages: boolean;
  network: "mainnet" | "testnet";
  epochs: number;
  namespace: string;
  preparedAt: number;
  draftId: string;
}

export interface PreparedResearchBundle {
  state: ResearchBundleDraftState;
  files: WalrusBundleSourceFile[];
  unsignedManifest: Record<string, unknown>;
}

export function researchBundleMarkdown(board: ResearchBoardState, includePassages: boolean): string {
  const sources = new Map(board.sources.map((source) => [source.sourceId, source]));
  const citations = new Map<string, number>();
  const lines = [`# ${board.title}`, "", board.summary, ""];
  for (const section of board.sections) {
    lines.push(`## ${section.heading}`, "");
    for (const claim of section.claims) {
      const markers = claim.citations.map((citation) => {
        const key = `${citation.sourceId}\u0000${citation.passageId}`;
        if (!citations.has(key)) citations.set(key, citations.size + 1);
        return `[^${citations.get(key)}]`;
      }).join("");
      lines.push(`- ${claim.text}${markers}`);
    }
    lines.push("");
  }
  lines.push("## Sources", "");
  for (const [key, number] of citations) {
    const [sourceId, passageId] = key.split("\u0000");
    const source = sources.get(sourceId!);
    const passage = source?.passages.find((item) => item.passageId === passageId);
    if (!source || !passage) continue;
    const passageHash = sha256(passage.text);
    lines.push(`[^${number}]: [${source.title}](${source.url}) — passage \`${passage.passageId}\`, SHA-256 \`${passageHash}\`, captured ${source.capturedAt}.`);
    if (includePassages) lines.push(`    > ${passage.text.replace(/\s+/g, " ").trim()}`);
  }
  return `${lines.join("\n").trim()}\n`;
}

export function researchBundleHtml(markdown: string): string {
  const body = markdown.split("\n").map((line) => line.startsWith("# ") ? `<h1>${escapeHtml(line.slice(2))}</h1>`
    : line.startsWith("## ") ? `<h2>${escapeHtml(line.slice(3))}</h2>`
      : line.startsWith("- ") ? `<p class="claim">${escapeHtml(line.slice(2))}</p>`
        : line.startsWith("    > ") ? `<blockquote>${escapeHtml(line.slice(6))}</blockquote>`
          : line.startsWith("[^") ? `<p class="source">${escapeHtml(line)}</p>`
            : line ? `<p>${escapeHtml(line)}</p>` : "").join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{font:15px -apple-system,BlinkMacSystemFont,sans-serif;color:#1c1e18;line-height:1.55;max-width:760px;margin:48px auto;padding:0 36px}h1{font-size:32px}h2{margin-top:30px;border-top:1px solid #d9dbd2;padding-top:16px}.claim{padding-left:18px;position:relative}.claim:before{content:'•';position:absolute;left:0;color:#71a900}.source{font-size:11px;color:#50554a;word-break:break-word}blockquote{font-size:12px;border-left:3px solid #a8b58f;margin:8px 0 16px;padding:6px 12px;color:#43483e}</style></head><body>${body}</body></html>`;
}

export function prepareResearchBundle(
  board: ResearchBoardState,
  pdf: Uint8Array,
  options: ResearchBundleOptions,
): PreparedResearchBundle {
  if (board.status !== "ready") throw new Error("Finish generating this Research Board before publishing it");
  if (!Number.isInteger(options.epochs) || options.epochs < 1 || options.epochs > 53) throw new Error("Walrus storage duration must be between 1 and 53 epochs");
  const boardJson = `${canonicalJson(sanitizedBoard(board, options.includePassages))}\n`;
  const markdown = researchBundleMarkdown(board, options.includePassages);
  const rawFiles = [
    { identifier: "board.json" as const, mediaType: "application/json", contents: Buffer.from(boardJson, "utf8") },
    { identifier: "research.md" as const, mediaType: "text/markdown; charset=utf-8", contents: Buffer.from(markdown, "utf8") },
    { identifier: "research.pdf" as const, mediaType: "application/pdf", contents: Buffer.from(pdf) },
  ];
  const manifestFiles = rawFiles.map((file) => ({
    identifier: file.identifier,
    mediaType: file.mediaType,
    bytes: file.contents.byteLength,
    sha256: sha256(file.contents),
  }));
  const unsignedManifest = {
    format: "locus-research-bundle-v1",
    boardId: board.id,
    title: board.title,
    preparedAt: new Date(options.preparedAt).toISOString(),
    visibility: options.visibility,
    includesCapturedPassages: options.includePassages,
    namespace: options.namespace,
    network: options.network,
    storageEpochs: options.epochs,
    files: manifestFiles,
  };
  return {
    state: {
      id: options.draftId,
      boardId: board.id,
      title: board.title,
      visibility: options.visibility,
      includePassages: options.includePassages,
      network: options.network,
      epochs: options.epochs,
      files: manifestFiles,
      previewMarkdown: markdown.slice(0, 60_000),
      unsignedManifestSha256: sha256(canonicalJson(unsignedManifest)),
      preparedAt: options.preparedAt,
    },
    files: rawFiles.map((file) => ({
      identifier: file.identifier,
      mediaType: file.mediaType,
      contentsBase64: file.contents.toString("base64"),
      sha256: sha256(file.contents),
    })),
    unsignedManifest,
  };
}

function sanitizedBoard(board: ResearchBoardState, includePassages: boolean): Record<string, unknown> {
  return {
    format: "locus-research-board-v1",
    id: board.id,
    title: board.title,
    artifact: board.format,
    summary: board.summary,
    createdAt: new Date(board.createdAt).toISOString(),
    updatedAt: new Date(board.updatedAt).toISOString(),
    sections: board.sections,
    sources: board.sources.map((source) => ({
      sourceId: source.sourceId,
      title: source.title,
      url: source.url,
      capturedAt: source.capturedAt,
      contentHash: source.contentHash,
      passages: source.passages.map((passage) => ({
        passageId: passage.passageId,
        sha256: sha256(passage.text),
        ...(includePassages ? { text: passage.text } : {}),
      })),
    })),
  };
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character]!);
}
