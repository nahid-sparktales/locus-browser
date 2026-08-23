import { describe, expect, it } from "vitest";
import { BrowserCommandSchema } from "./ipc.js";

describe("renderer IPC fuzz boundary", () => {
  it("rejects malformed commands and strips unexpected secret-shaped fields", () => {
    const configured = BrowserCommandSchema.parse({
      type: "configure-work-provider",
      providerId: "openai-api",
      model: "gpt-5.6",
      apiKey: "must-not-cross-renderer-ipc",
      token: "must-not-cross-renderer-ipc",
    });
    expect(configured).not.toHaveProperty("apiKey");
    expect(configured).not.toHaveProperty("token");

    let state = 0xdecafbad;
    const types = [null, true, 0, "", "__proto__", "navigate", "work-send", "configure-work-provider"];
    for (let index = 0; index < 1_000; index += 1) {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
      const type = types[state % types.length];
      const value = {
        type,
        text: index % 3 ? { nested: ["x", null, index] } : "x".repeat(index % 250),
        value: index % 2 ? `https://example.com/${index}` : [index],
        providerId: index % 2 ? "openai-api" : "unknown",
        model: index % 5 ? "gpt-5.6" : "",
        width: index % 2 ? Number.NaN : Number.POSITIVE_INFINITY,
        __proto__: { polluted: true },
      };
      expect(() => BrowserCommandSchema.safeParse(value)).not.toThrow();
    }
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });
});
