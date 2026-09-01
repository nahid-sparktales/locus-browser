export const ACCENT_PRESET_IDS = [
  "lime",
  "green",
  "blue",
  "purple",
  "orange",
  "pink",
  "neutral",
] as const;

export type AccentPresetId = typeof ACCENT_PRESET_IDS[number];
export type AccentSelectionId = AccentPresetId | "custom";

export interface AccentSelectionState {
  preset: AccentSelectionId;
  customHex: string;
}

export interface AccentOption {
  id: AccentPresetId;
  title: string;
  fillHex: string;
  logoHex: string;
}

export interface ResolvedAccentPalette {
  fillHex: string;
  logoHex: string;
  actionLightHex: string;
  actionDarkHex: string;
  brandInkHex: string;
}

export const DEFAULT_CUSTOM_ACCENT_HEX = "4A90FF";
export const DEFAULT_ACCENT_SELECTION: AccentSelectionState = {
  preset: "lime",
  customHex: DEFAULT_CUSTOM_ACCENT_HEX,
};

/** Kept byte-for-byte aligned with the seven presets in native Locus. */
export const ACCENT_OPTIONS: readonly AccentOption[] = [
  { id: "lime", title: "Lime", fillHex: "C9F54A", logoHex: "DAF66C" },
  { id: "green", title: "Green", fillHex: "2F7D4C", logoHex: "4C9967" },
  { id: "blue", title: "Blue", fillHex: "4A90FF", logoHex: "67A9FF" },
  { id: "purple", title: "Purple", fillHex: "A56EFF", logoHex: "BC86FF" },
  { id: "orange", title: "Orange", fillHex: "FF9F43", logoHex: "FFB15F" },
  { id: "pink", title: "Pink", fillHex: "FF5FA2", logoHex: "FF82B6" },
  { id: "neutral", title: "Neutral", fillHex: "D4D5D2", logoHex: "E1E2DE" },
];

const ACCENT_OPTION_BY_ID = new Map(ACCENT_OPTIONS.map((option) => [option.id, option]));
const HEX_PATTERN = /^[0-9A-F]{6}$/;
const LIGHT_BACKGROUND = hexToRgb("F3F1EA");
const DARK_BACKGROUND = hexToRgb("171713");
const DARK_INK = hexToRgb("161814");
const LIGHT_INK = hexToRgb("FFFDF8");
const BLACK = hexToRgb("000000");
const WHITE = hexToRgb("FFFFFF");

type RGB = readonly [number, number, number];

export function isAccentSelectionId(value: unknown): value is AccentSelectionId {
  return value === "custom" || ACCENT_PRESET_IDS.some((preset) => preset === value);
}

export function normalizeAccentHex(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().replace(/^#/, "").toUpperCase();
  return HEX_PATTERN.test(normalized) ? normalized : undefined;
}

export function resolveAccentSelection(preset: unknown, customHex: unknown): AccentSelectionState {
  return {
    preset: isAccentSelectionId(preset) ? preset : DEFAULT_ACCENT_SELECTION.preset,
    customHex: normalizeAccentHex(customHex) ?? DEFAULT_CUSTOM_ACCENT_HEX,
  };
}

export function resolveAccentPalette(selection: AccentSelectionState): ResolvedAccentPalette {
  const option = selection.preset === "custom" ? undefined : ACCENT_OPTION_BY_ID.get(selection.preset);
  const fillHex = option?.fillHex ?? normalizeAccentHex(selection.customHex) ?? DEFAULT_CUSTOM_ACCENT_HEX;
  const logoHex = option?.logoHex ?? fillHex;
  const fill = hexToRgb(fillHex);
  const logo = hexToRgb(logoHex);
  return {
    fillHex: `#${fillHex}`,
    logoHex: `#${logoHex}`,
    actionLightHex: rgbToHex(firstReadableMix(fill, BLACK, LIGHT_BACKGROUND)),
    actionDarkHex: rgbToHex(firstReadableMix(fill, WHITE, DARK_BACKGROUND)),
    brandInkHex: rgbToHex(contrast(DARK_INK, logo) >= contrast(LIGHT_INK, logo) ? DARK_INK : LIGHT_INK),
  };
}

export function accentCssVariables(selection: AccentSelectionState): Record<string, string> {
  const palette = resolveAccentPalette(selection);
  return {
    "--brand": palette.fillHex,
    "--brand-logo": palette.logoHex,
    "--brand-ink": palette.brandInkHex,
    "--accent-light": palette.actionLightHex,
    "--accent-dark": palette.actionDarkHex,
  };
}

function firstReadableMix(source: RGB, destination: RGB, background: RGB): RGB {
  for (let step = 0; step <= 20; step += 1) {
    const candidate = mix(source, destination, step / 20);
    if (contrast(candidate, background) >= 4.5) return candidate;
  }
  return destination;
}

function mix(left: RGB, right: RGB, fraction: number): RGB {
  return [
    left[0] + (right[0] - left[0]) * fraction,
    left[1] + (right[1] - left[1]) * fraction,
    left[2] + (right[2] - left[2]) * fraction,
  ];
}

function contrast(foreground: RGB, background: RGB): number {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

function luminance(color: RGB): number {
  const channel = (value: number) => {
    const component = value / 255;
    return component <= 0.04045 ? component / 12.92 : ((component + 0.055) / 1.055) ** 2.4;
  };
  return channel(color[0]) * 0.2126 + channel(color[1]) * 0.7152 + channel(color[2]) * 0.0722;
}

function hexToRgb(hex: string): RGB {
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
  ];
}

function rgbToHex(color: RGB): string {
  return `#${color.map((component) => Math.round(component).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}
