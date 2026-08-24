import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BrowserDatabase } from "./BrowserDatabase.js";
import type { CredentialCipher } from "./CredentialVault.js";
import { TranscriptVault } from "./TranscriptVault.js";

const cipher: CredentialCipher = {
  available: () => true,
  encrypt: (value) => new TextEncoder().encode(`wrapped:${value}`),
  decrypt: (value) => new TextDecoder().decode(value).replace(/^wrapped:/, ""),
};

describe("TranscriptVault", () => {
  it("round-trips transcript records without storing their text in SQLite", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "locus-transcript-")), "browser.sqlite");
    const database = new BrowserDatabase(path);
    database.createRecordingSession({
      id: "recording-1", profileId: "default", workSessionId: "work-1",
      startedAt: 1, status: "recording", engine: "local",
      sourcesJson: JSON.stringify({ tabAudio: true, microphone: true }), saveVideo: false,
    });
    const vault = new TranscriptVault(database, cipher, "default");
    await vault.add({
      recordingId: "recording-1", source: "microphone", startMs: 0, endMs: 800,
      text: "private live transcript phrase", tabId: "tab-1",
    });

    expect(await vault.segments("recording-1")).toMatchObject([{
      source: "microphone", text: "private live transcript phrase", tabId: "tab-1",
    }]);
    database.close();
    expect(readFileSync(path).includes(Buffer.from("private live transcript phrase"))).toBe(false);
  });

  it("deletes the transcript and its encrypted segments together", async () => {
    const database = new BrowserDatabase(join(mkdtempSync(join(tmpdir(), "locus-transcript-delete-")), "browser.sqlite"));
    database.createRecordingSession({
      id: "recording-2", profileId: "default", workSessionId: "work-2",
      startedAt: 1, status: "recording", engine: "local", sourcesJson: "{}", saveVideo: false,
    });
    const vault = new TranscriptVault(database, cipher, "default");
    await vault.add({ recordingId: "recording-2", source: "tab", startMs: 0, endMs: 100, text: "remove me" });
    vault.delete("recording-2");
    expect(vault.summaries()).toEqual([]);
    expect(database.recordingSegments("recording-2")).toEqual([]);
    database.close();
  });
});
