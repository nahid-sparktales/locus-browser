import { describe, expect, it } from "vitest";
import { parseNativeSecretPromptResult } from "./NativeSecretPrompt.js";

describe("native provider-key prompt", () => {
  it("accepts a bounded secret or an explicit cancellation", () => {
    expect(parseNativeSecretPromptResult('{"value":"  sk-test  "}')).toEqual({ value: "sk-test" });
    expect(parseNativeSecretPromptResult('{"cancelled":true}')).toEqual({ cancelled: true });
  });

  it("rejects malformed helper output", () => {
    expect(() => parseNativeSecretPromptResult("button returned:Save")).toThrow("invalid response");
  });
});
