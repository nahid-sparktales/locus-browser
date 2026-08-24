import { describe, expect, it } from "vitest";
import { runWithEphemeralAudio, validateSpeechEndpoint } from "./SpeechRuntime.js";

describe("speech endpoint policy", () => {
  it("allows HTTPS and loopback HTTP transcription endpoints", () => {
    expect(validateSpeechEndpoint("https://speech.example.com/v1").origin).toBe("https://speech.example.com");
    expect(validateSpeechEndpoint("http://127.0.0.1:8000/v1").origin).toBe("http://127.0.0.1:8000");
    expect(validateSpeechEndpoint("http://localhost:9000/v1").origin).toBe("http://localhost:9000");
  });

  it("rejects credentials, unsupported schemes, and local-network HTTP", () => {
    expect(() => validateSpeechEndpoint("https://user:secret@speech.example.com/v1")).toThrow("credentials");
    expect(() => validateSpeechEndpoint("https://speech.example.com/v1?api_key=secret")).toThrow("query parameters");
    expect(() => validateSpeechEndpoint("ftp://speech.example.com/v1")).toThrow("HTTPS");
    expect(() => validateSpeechEndpoint("http://192.168.1.5:8000/v1")).toThrow("HTTPS");
  });

  it("streams raw audio through an anonymous child-process pipe", async () => {
    const script = "const fs=require('node:fs');const value=fs.readFileSync(3);process.stdout.write(value.toString('hex'))";
    await expect(runWithEphemeralAudio(process.execPath, ["-e", script], Uint8Array.from([0, 1, 254, 255]), 5_000))
      .resolves.toBe("0001feff");
  });
});
