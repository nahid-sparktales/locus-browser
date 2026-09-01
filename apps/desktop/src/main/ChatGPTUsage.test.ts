import { describe, expect, it } from "vitest";
import { normalizeChatGPTUsage, preferredChatGPTModel } from "./ChatGPTUsage.js";

describe("normalizeChatGPTUsage", () => {
  it("keeps only bounded, secret-free usage windows", () => {
    const value = normalizeChatGPTUsage({
      plan_type: "plus",
      token: "must-not-leak",
      rate_limits: {
        primary: { usedPercent: 34.5, windowDurationMins: 300, resetsAt: 1_800_000_000 },
        secondary: { used_percent: 100, window_duration_minutes: 10_080, resets_at: "2027-01-01T00:00:00Z" },
        malformed: { usedPercent: "all of it", apiKey: "secret" },
      },
    });
    expect(value.windows).toEqual([
      { id: "primary", label: "Primary window", usedPercent: 34.5, windowDurationMinutes: 300, resetsAt: 1_800_000_000, reached: false },
      { id: "secondary", label: "Secondary window", usedPercent: 100, windowDurationMinutes: 10_080, resetsAt: 1_798_761_600, reached: true },
    ]);
    expect(JSON.stringify(value)).not.toContain("secret");
    expect(JSON.stringify(value)).not.toContain("token");
  });

  it("returns an empty safe shape for malformed backend data", () => {
    expect(normalizeChatGPTUsage({ rate_limits: ["unexpected"] })).toEqual({ windows: [] });
    expect(normalizeChatGPTUsage(null)).toEqual({ windows: [] });
  });

  it("normalizes the App Server rate-limit envelope", () => {
    expect(normalizeChatGPTUsage({
      rate_limits: { rateLimits: { primary: { usedPercent: 8, windowDurationMins: 300, resetsAt: 1_800_000_000 } } },
    }).windows[0]).toMatchObject({ id: "primary", usedPercent: 8, windowDurationMinutes: 300 });
  });

  it("selects the account-reported default model after sign-in", () => {
    expect(preferredChatGPTModel([
      { id: "first" }, { id: "account-default", is_default: true },
    ])).toBe("account-default");
    expect(preferredChatGPTModel([{ id: "fallback" }])).toBe("fallback");
  });
});
