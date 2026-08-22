import { describe, expect, it } from "vitest";
import { TabAccessRegistry } from "./TabAccessRegistry.js";

describe("TabAccessRegistry", () => {
  it("keeps access scoped to an explicit session and tab", () => {
    const registry = new TabAccessRegistry();
    registry.grant("session-a", "tab-1", "interact", "user_share");
    expect(registry.can("session-a", "tab-1", "read")).toBe(true);
    expect(registry.can("session-a", "tab-1", "interact")).toBe(true);
    expect(registry.can("session-b", "tab-1", "read")).toBe(false);
    expect(registry.can("session-a", "tab-2", "read")).toBe(false);
  });

  it("revokes a complete session without closing tabs", () => {
    const registry = new TabAccessRegistry();
    registry.grant("session-a", "tab-1", "read", "agent_created");
    registry.revokeSession("session-a");
    expect(registry.grantsForTab("tab-1")).toEqual([]);
  });

  it("refuses private and internal browser URLs", () => {
    expect(TabAccessRegistry.isProtectedUrl("https://example.com", false)).toBe(false);
    expect(TabAccessRegistry.isProtectedUrl("https://example.com", true)).toBe(true);
    expect(TabAccessRegistry.isProtectedUrl("file:///tmp/secret", false)).toBe(true);
    expect(TabAccessRegistry.isProtectedUrl("locus://settings", false)).toBe(true);
  });
});
