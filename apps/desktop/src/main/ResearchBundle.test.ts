import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ResearchBoardState } from "../shared/types.js";
import { prepareResearchBundle, researchBundleMarkdown } from "./ResearchBundle.js";
import { BrowserDatabase } from "./BrowserDatabase.js";

const board: ResearchBoardState = {
  id: "board-1",
  workSessionId: "session-1",
  prompt: "Compare the evidence",
  format: "brief",
  title: "Verified finding",
  summary: "The sources support the conclusion.",
  sections: [{
    heading: "Conclusion",
    claims: [{ text: "The result is reproducible.", citations: [{ sourceId: "source-1", passageId: "passage-1" }] }],
  }],
  sources: [{
    sourceId: "source-1",
    tabId: "tab-1",
    title: "Primary source",
    url: "https://example.com/source",
    capturedAt: "2026-08-26T12:00:00.000Z",
    contentHash: "a".repeat(64),
    passages: [{ passageId: "passage-1", text: "Sensitive captured evidence text." }],
  }],
  status: "ready",
  createdAt: Date.parse("2026-08-26T12:00:00.000Z"),
  updatedAt: Date.parse("2026-08-26T12:05:00.000Z"),
};

describe("verifiable research bundles", () => {
  it("publishes hashes, claims, citations, and URLs without captured passage text by default", () => {
    const prepared = prepareResearchBundle(board, new Uint8Array([37, 80, 68, 70]), {
      visibility: "public", includePassages: false, network: "testnet", epochs: 5,
      namespace: "locus-browser-v1", preparedAt: board.updatedAt, draftId: "draft-1",
    });
    const serialized = prepared.files.map((file) => Buffer.from(file.contentsBase64, "base64").toString("utf8")).join("\n");
    expect(serialized).toContain("https://example.com/source");
    expect(serialized).toContain("passage-1");
    expect(serialized).toMatch(/[a-f0-9]{64}/);
    expect(serialized).not.toContain("Sensitive captured evidence text.");
    expect(prepared.state.files).toHaveLength(3);
    expect(prepared.state.unsignedManifestSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("includes captured passage text only after that option is explicitly enabled", () => {
    const markdown = researchBundleMarkdown(board, true);
    expect(markdown).toContain("Sensitive captured evidence text.");
    expect(markdown).toContain("SHA-256");
  });

  it("produces deterministic artifact hashes for an identical preview", () => {
    const options = {
      visibility: "seal-encrypted" as const, includePassages: false, network: "mainnet" as const, epochs: 10,
      namespace: "project-one", preparedAt: board.updatedAt, draftId: "draft-1",
    };
    const first = prepareResearchBundle(board, new Uint8Array([1, 2, 3]), options);
    const second = prepareResearchBundle(board, new Uint8Array([1, 2, 3]), options);
    expect(first.state.files).toEqual(second.state.files);
    expect(first.state.unsignedManifestSha256).toBe(second.state.unsignedManifestSha256);
  });

  it("retains only content-free quilt receipts and excludes them from browser sync", () => {
    const database = new BrowserDatabase(join(mkdtempSync(join(tmpdir(), "locus-quilt-receipt-")), "browser.sqlite3"));
    database.saveResearchBundleReceipt("default", {
      id: "receipt-1", boardId: "board-1", quiltId: "quilt-1", manifestSha256: "f".repeat(64),
      visibility: "public", network: "testnet", epochs: 5, signerAddress: "0xsigner",
      filesJson: JSON.stringify([{ identifier: "manifest.json", id: "patch-1", blobId: "quilt-1" }]), createdAt: board.updatedAt,
    });
    expect(database.listResearchBundleReceipts("default")).toEqual([expect.objectContaining({ quiltId: "quilt-1", filesJson: expect.not.stringContaining("Sensitive captured evidence") })]);
    database.queueSyncSnapshot("default", "device-1", () => "0001:device-1");
    expect(JSON.stringify(database.syncOutbox("default"))).not.toContain("quilt-1");
    database.close();
  });
});
