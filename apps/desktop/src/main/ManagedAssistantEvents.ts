import { randomUUID } from "node:crypto";
import type { WorkMessage } from "../shared/types.js";
import type { AgentEvent } from "./AgentRuntime.js";

type ManagedAssistantItem = {
  kind: "message" | "reasoning";
  message: WorkMessage;
  sections: string[];
};

export type ManagedAssistantActivity = {
  phase: "thinking" | "responding";
  label: string;
};

/** Adapts the structured, public App Server output stream to the Work chat UI. */
export class ManagedAssistantEventAdapter {
  readonly #items = new Map<string, ManagedAssistantItem>();
  #activeMessage: WorkMessage | undefined;

  apply(messages: WorkMessage[], event: AgentEvent): ManagedAssistantActivity | undefined {
    const type = String(event.type ?? "");
    if (!new Set(["assistant_item_start", "assistant_item_delta", "assistant_item_end"]).has(type)) return undefined;
    const kind = event.kind === "reasoning" ? "reasoning" : event.kind === "message" ? "message" : undefined;
    if (!kind) return undefined;
    const itemId = String(event.item_id ?? event.id ?? "").trim() || randomUUID();
    const item = this.#items.get(itemId) ?? this.#startItem(messages, itemId, kind);

    if (type === "assistant_item_delta") {
      const delta = typeof event.text === "string" ? event.text : "";
      if (kind === "message") item.message.text += delta;
      else this.#updateReasoning(item, event.section_index, delta);
    } else if (type === "assistant_item_end") {
      if (kind === "message") {
        if (typeof event.text === "string") item.message.text = event.text;
        item.message.streaming = false;
      } else if (Array.isArray(event.sections)) {
        item.sections = event.sections.filter((section): section is string => typeof section === "string");
        item.message.reasoningText = item.sections.filter(Boolean).join("\n\n");
      }
      this.#items.delete(itemId);
    }

    return kind === "message"
      ? { phase: type === "assistant_item_end" ? "thinking" : "responding", label: type === "assistant_item_end" ? "Thinking…" : "Responding…" }
      : { phase: "thinking", label: "Thinking…" };
  }

  #startItem(messages: WorkMessage[], itemId: string, kind: "message" | "reasoning"): ManagedAssistantItem {
    let message = this.#activeMessage;
    if (!message?.streaming || !messages.includes(message)) {
      message = { id: itemId, role: "assistant", text: "", streaming: true };
      messages.push(message);
      this.#activeMessage = message;
    }
    const item = { kind, message, sections: [] } satisfies ManagedAssistantItem;
    this.#items.set(itemId, item);
    return item;
  }

  #updateReasoning(item: ManagedAssistantItem, rawIndex: unknown, delta: string): void {
    const numericIndex = typeof rawIndex === "number" && Number.isInteger(rawIndex) ? rawIndex : 0;
    const index = Math.max(0, Math.min(numericIndex, 100));
    while (item.sections.length <= index) item.sections.push("");
    item.sections[index] += delta;
    item.message.reasoningText = item.sections.filter(Boolean).join("\n\n");
  }
}
