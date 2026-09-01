import type { ChatGPTUsageState, ChatGPTUsageWindowState } from "../shared/types.js";

type UnknownRecord = Record<string, unknown>;

export function normalizeChatGPTUsage(value: unknown): ChatGPTUsageState {
  const root = record(value);
  const rateLimitEnvelope = record(root?.rate_limits ?? root?.rateLimits);
  const rateLimits = record(rateLimitEnvelope?.rateLimits ?? rateLimitEnvelope?.rate_limits) ?? rateLimitEnvelope;
  const windows: ChatGPTUsageWindowState[] = [];
  for (const [rawId, rawWindow] of Object.entries(rateLimits ?? {}).slice(0, 8)) {
    const window = record(rawWindow);
    if (!window) continue;
    const usedPercent = finiteNumber(window.usedPercent ?? window.used_percent);
    if (usedPercent === undefined) continue;
    const id = rawId.toLowerCase().replace(/[^a-z0-9_-]/g, "-").slice(0, 64) || `window-${windows.length + 1}`;
    const duration = finiteNumber(window.windowDurationMins ?? window.window_duration_mins ?? window.windowDurationMinutes ?? window.window_duration_minutes);
    const resetsAt = timestampSeconds(window.resetsAt ?? window.resets_at);
    const normalizedPercent = Math.min(100, Math.max(0, usedPercent));
    windows.push({
      id,
      label: usageWindowLabel(rawId, duration),
      usedPercent: normalizedPercent,
      ...(duration !== undefined && duration >= 0 ? { windowDurationMinutes: duration } : {}),
      ...(resetsAt !== undefined ? { resetsAt } : {}),
      reached: Boolean(window.reached ?? window.limit_reached) || normalizedPercent >= 100,
    });
  }
  return { windows };
}

export function preferredChatGPTModel(models: Array<{ id: string; is_default?: boolean }>): string {
  return models.find((model) => model.is_default)?.id || models[0]?.id || "";
}

function usageWindowLabel(id: string, duration: number | undefined): string {
  const normalized = id.toLowerCase();
  if (normalized === "primary") return "Primary window";
  if (normalized === "secondary") return "Secondary window";
  if (duration && duration < 24 * 60) return `${formatDuration(duration)} window`;
  if (duration) return `${formatDuration(duration)} window`;
  return "Usage window";
}

function formatDuration(minutes: number): string {
  if (minutes % (7 * 24 * 60) === 0) return `${minutes / (7 * 24 * 60)} week`;
  if (minutes % (24 * 60) === 0) return `${minutes / (24 * 60)} day`;
  if (minutes % 60 === 0) return `${minutes / 60} hour`;
  return `${minutes} minute`;
}

function record(value: unknown): UnknownRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function timestampSeconds(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value > 10_000_000_000 ? Math.floor(value / 1_000) : value;
  if (typeof value === "string" && value.length <= 64) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return Math.floor(parsed / 1_000);
  }
  return undefined;
}
