import { z } from "zod";
import type { WorkPlanState, WorkTerminalEntryState, WorkTodoState } from "../shared/types.js";
import type { AgentEvent } from "./AgentRuntime.js";

const TodoSchema = z.object({
  content: z.string().trim().min(1).max(1_000),
  status: z.enum(["pending", "in_progress", "completed"]),
});
const PlanSchema = z.object({
  id: z.string().trim().min(1).max(255),
  title: z.string().trim().min(1).max(160),
  summary: z.string().trim().max(4_000).default(""),
  steps: z.array(z.string().trim().min(1).max(1_000)).max(100),
  tests: z.array(z.string().trim().min(1).max(1_000)).max(100).default([]),
});

export function updateWorkPlan(current: WorkPlanState | undefined, event: AgentEvent): WorkPlanState | undefined {
  if (event.type === "plan_ready") {
    const parsed = PlanSchema.safeParse(event.plan);
    if (!parsed.success || !parsed.data.steps.length) return current;
    return {
      id: parsed.data.id,
      title: parsed.data.title,
      summary: parsed.data.summary,
      steps: parsed.data.steps.map((content) => ({ content, status: "pending" })),
      tests: parsed.data.tests,
      pendingApproval: true,
    };
  }
  if (event.type !== "todo_update") return current;
  const parsed = z.array(TodoSchema).max(100).safeParse(event.todos);
  if (!parsed.success) return current;
  const steps: WorkTodoState[] = parsed.data;
  if (!steps.length) return undefined;
  return current
    ? { ...current, steps }
    : { id: "active-todos", title: "Current plan", summary: "", steps, tests: [], pendingApproval: false };
}

export function updateWorkTerminal(
  current: WorkTerminalEntryState[],
  event: AgentEvent,
  now = Date.now(),
): WorkTerminalEntryState[] {
  const type = String(event.type ?? "");
  if (!new Set(["tool_call_proposed", "permission_request", "tool_result"]).has(type)) return current;
  const id = bounded(event.id, 255) || bounded(event.request_id, 255);
  if (!id) return current;
  const existingIndex = current.findIndex((entry) => entry.id === id);
  const existing = existingIndex >= 0 ? current[existingIndex] : undefined;
  const status = type === "permission_request"
    ? "waiting" as const
    : type === "tool_result"
      ? event.denied === true ? "denied" as const : event.ok === true ? "done" as const : "error" as const
      : event.auto === false ? "waiting" as const : "running" as const;
  const next: WorkTerminalEntryState = {
    id,
    tool: bounded(event.tool, 160) || existing?.tool || "tool",
    summary: bounded(event.summary, 1_000) || existing?.summary || "Agent tool",
    detail: bounded(event.detail, 2_000) || existing?.detail || "",
    status,
    ...(type === "tool_result" ? { result: bounded(event.result, 8_000), finishedAt: now } : {}),
    startedAt: existing?.startedAt ?? now,
  };
  const values = existingIndex >= 0
    ? current.map((entry, index) => index === existingIndex ? next : entry)
    : [...current, next];
  return values.slice(-80);
}

export function interruptRunningWorkTerminal(current: WorkTerminalEntryState[], now = Date.now()): WorkTerminalEntryState[] {
  return current.map((entry) => entry.status === "running" || entry.status === "waiting"
    ? { ...entry, status: "interrupted", finishedAt: now }
    : entry);
}

export function isTerminalWorkTurnEvent(type: string): boolean {
  return type === "turn_end" || type === "turn_done";
}

function bounded(value: unknown, length: number): string {
  return typeof value === "string" ? value.replaceAll("\0", "").slice(0, length) : "";
}
