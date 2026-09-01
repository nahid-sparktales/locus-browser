import { describe, expect, it } from "vitest";
import type { WorkMessage } from "../shared/types.js";
import { ManagedAssistantEventAdapter } from "./ManagedAssistantEvents.js";

describe("ManagedAssistantEventAdapter", () => {
  it("combines public reasoning summaries and the final answer into one visible reply", () => {
    const adapter = new ManagedAssistantEventAdapter();
    const messages: WorkMessage[] = [];

    adapter.apply(messages, { type: "assistant_item_start", item_id: "reason-1", kind: "reasoning" });
    adapter.apply(messages, { type: "assistant_item_delta", item_id: "reason-1", kind: "reasoning", section_index: 0, text: "Checking" });
    adapter.apply(messages, { type: "assistant_item_delta", item_id: "reason-1", kind: "reasoning", section_index: 1, text: "Done" });
    adapter.apply(messages, { type: "assistant_item_end", item_id: "reason-1", kind: "reasoning", sections: ["Checking", "Done"] });
    adapter.apply(messages, { type: "assistant_item_start", item_id: "message-1", kind: "message", phase: "final_answer" });
    adapter.apply(messages, { type: "assistant_item_delta", item_id: "message-1", kind: "message", text: "CHATGPT " });
    adapter.apply(messages, { type: "assistant_item_end", item_id: "message-1", kind: "message", text: "CHATGPT PLAN OK" });

    expect(messages).toEqual([{
      id: "reason-1",
      role: "assistant",
      text: "CHATGPT PLAN OK",
      reasoningText: "Checking\n\nDone",
      streaming: false,
    }]);
  });

  it("uses authoritative completed text when the helper sends no deltas", () => {
    const adapter = new ManagedAssistantEventAdapter();
    const messages: WorkMessage[] = [];

    const activity = adapter.apply(messages, {
      type: "assistant_item_end",
      item_id: "message-2",
      kind: "message",
      text: "Recovered final answer",
    });

    expect(activity).toEqual({ phase: "thinking", label: "Thinking…" });
    expect(messages[0]).toMatchObject({ text: "Recovered final answer", streaming: false });
  });

  it("ignores unrelated and private-reasoning-shaped events", () => {
    const adapter = new ManagedAssistantEventAdapter();
    const messages: WorkMessage[] = [];

    expect(adapter.apply(messages, { type: "reasoning_delta", text: "private" })).toBeUndefined();
    expect(messages).toEqual([]);
  });
});
