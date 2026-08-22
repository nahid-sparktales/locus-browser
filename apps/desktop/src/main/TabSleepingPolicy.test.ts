import { describe, expect, it } from "vitest";
import { canSleepTab, shouldSleepTab } from "./TabSleepingPolicy.js";

const idle = {
  active: false,
  sleeping: false,
  loading: false,
  audible: false,
  mediaPlaying: false,
  granted: false,
  downloading: false,
};

describe("tab sleeping policy", () => {
  it("allows an idle background tab to sleep", () => {
    expect(canSleepTab(idle)).toBe(true);
    expect(shouldSleepTab({ ...idle, lastActiveAt: 1_000 }, 31 * 60_000, 30)).toBe(true);
  });

  it.each(["active", "loading", "audible", "mediaPlaying", "granted", "downloading"] as const)(
    "protects a tab that is %s",
    (condition) => expect(canSleepTab({ ...idle, [condition]: true })).toBe(false),
  );

  it("respects disabled and not-yet-due automatic sleeping", () => {
    expect(shouldSleepTab({ ...idle, lastActiveAt: 0 }, 60 * 60_000, 0)).toBe(false);
    expect(shouldSleepTab({ ...idle, lastActiveAt: 25 * 60_000 }, 30 * 60_000, 15)).toBe(false);
  });
});
