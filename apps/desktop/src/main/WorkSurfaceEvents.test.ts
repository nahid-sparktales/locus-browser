import { describe, expect, it } from "vitest";
import { interruptRunningWorkTerminal, updateWorkPlan, updateWorkTerminal } from "./WorkSurfaceEvents.js";

describe("Solo Work surface events", () => {
  it("turns plan and todo events into a decision-ready plan", () => {
    const plan = updateWorkPlan(undefined, {
      type: "plan_ready",
      plan: { id: "plan-1", title: "Ship it", summary: "Focused work", steps: ["Build", "Verify"], tests: ["Smoke test"] },
    });
    expect(plan).toMatchObject({ title: "Ship it", pendingApproval: true });
    expect(plan?.steps[0]).toEqual({ content: "Build", status: "pending" });
    const updated = updateWorkPlan(plan, { type: "todo_update", todos: [
      { content: "Build", status: "completed" }, { content: "Verify", status: "in_progress" },
    ] });
    expect(updated?.steps.map((step) => step.status)).toEqual(["completed", "in_progress"]);
  });

  it("keeps a bounded tool timeline and settles interrupted entries", () => {
    const started = updateWorkTerminal([], { type: "tool_call_proposed", id: "call-1", tool: "bash", summary: "Run tests", detail: "pnpm test", auto: true }, 10);
    const finished = updateWorkTerminal(started, { type: "tool_result", id: "call-1", tool: "bash", summary: "Run tests", result: "57 passed", ok: true }, 20);
    expect(finished[0]).toMatchObject({ status: "done", result: "57 passed", startedAt: 10, finishedAt: 20 });
    expect(interruptRunningWorkTerminal(updateWorkTerminal([], { type: "tool_call_proposed", id: "call-2", tool: "bash", auto: true }, 30), 40)[0]?.status).toBe("interrupted");
  });
});
