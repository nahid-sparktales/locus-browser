import { z } from "zod";

export const ipcChannels = {
  getState: "browser:get-state",
  command: "browser:command",
  state: "browser:state",
  focusAddress: "browser:focus-address",
} as const;

export const BrowserCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("new-tab"), url: z.string().optional() }),
  z.object({ type: z.literal("select-tab"), tabId: z.string().min(1) }),
  z.object({ type: z.literal("close-tab"), tabId: z.string().min(1) }),
  z.object({ type: z.literal("reorder-tab"), tabId: z.string().min(1), beforeTabId: z.string().min(1) }),
  z.object({ type: z.literal("navigate"), value: z.string().min(1) }),
  z.object({ type: z.literal("back") }),
  z.object({ type: z.literal("forward") }),
  z.object({ type: z.literal("reload") }),
  z.object({ type: z.literal("stop") }),
  z.object({ type: z.literal("toggle-sidebar") }),
  z.object({ type: z.literal("toggle-work") }),
  z.object({ type: z.literal("set-work-width"), width: z.number().finite() }),
  z.object({ type: z.literal("set-reduced-motion"), enabled: z.boolean() }),
  z.object({ type: z.literal("share-active-tab"), level: z.enum(["read", "interact"]) }),
  z.object({ type: z.literal("revoke-active-tab") }),
  z.object({ type: z.literal("set-work-mode"), mode: z.enum(["ask", "work", "plan", "build"]) }),
  z.object({
    type: z.literal("set-work-panel"),
    panel: z.enum(["chat", "overview", "plan", "changes", "files", "terminal", "checkpoints", "runs", "notes", "agents"]),
  }),
  z.object({ type: z.literal("work-send"), text: z.string().trim().min(1).max(200_000) }),
  z.object({ type: z.literal("stop-work") }),
  z.object({ type: z.literal("answer-permission"), requestId: z.string().min(1), decision: z.enum(["allow", "always", "deny"]) }),
]);

export type BrowserCommand = z.infer<typeof BrowserCommandSchema>;
