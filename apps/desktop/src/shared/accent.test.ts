import { describe, expect, it } from "vitest";
import {
  ACCENT_OPTIONS,
  DEFAULT_ACCENT_SELECTION,
  accentCssVariables,
  normalizeAccentHex,
  resolveAccentPalette,
  resolveAccentSelection,
} from "./accent.js";

describe("Locus accent palette", () => {
  it("matches every native Locus preset and its separate logo treatment", () => {
    expect(ACCENT_OPTIONS).toEqual([
      { id: "lime", title: "Lime", fillHex: "C9F54A", logoHex: "DAF66C" },
      { id: "green", title: "Green", fillHex: "2F7D4C", logoHex: "4C9967" },
      { id: "blue", title: "Blue", fillHex: "4A90FF", logoHex: "67A9FF" },
      { id: "purple", title: "Purple", fillHex: "A56EFF", logoHex: "BC86FF" },
      { id: "orange", title: "Orange", fillHex: "FF9F43", logoHex: "FFB15F" },
      { id: "pink", title: "Pink", fillHex: "FF5FA2", logoHex: "FF82B6" },
      { id: "neutral", title: "Neutral", fillHex: "D4D5D2", logoHex: "E1E2DE" },
    ]);
  });

  it("normalizes custom colours and falls back without disturbing the default", () => {
    expect(normalizeAccentHex(" #a56eff ")).toBe("A56EFF");
    expect(normalizeAccentHex("not-a-colour")).toBeUndefined();
    expect(resolveAccentSelection("custom", "ff5fa2")).toEqual({ preset: "custom", customHex: "FF5FA2" });
    expect(resolveAccentSelection("future-preset", "invalid")).toEqual(DEFAULT_ACCENT_SELECTION);
  });

  it("derives independent readable foregrounds, fills, logos, and icon ink", () => {
    expect(resolveAccentPalette({ preset: "lime", customHex: "4A90FF" })).toEqual({
      fillHex: "#C9F54A",
      logoHex: "#DAF66C",
      actionLightHex: "#5A6E21",
      actionDarkHex: "#C9F54A",
      brandInkHex: "#161814",
    });
    expect(resolveAccentPalette({ preset: "custom", customHex: "101010" })).toEqual({
      fillHex: "#101010",
      logoHex: "#101010",
      actionLightHex: "#101010",
      actionDarkHex: "#888888",
      brandInkHex: "#FFFDF8",
    });
    expect(accentCssVariables({ preset: "blue", customHex: "4A90FF" })).toMatchObject({
      "--brand": "#4A90FF",
      "--brand-logo": "#67A9FF",
      "--brand-ink": "#161814",
      "--accent-light": "#386CBF",
      "--accent-dark": "#4A90FF",
    });
  });
});
