import { describe, expect, it, vi } from "vitest";
import { commitVerifiedProviderConnection, removeProviderCredential } from "./WorkProviderLifecycle.js";

describe("provider credential lifecycle", () => {
  it("does not connect, persist, or activate after a failed verification probe", async () => {
    const connect = vi.fn(async () => ({ model: "kimi-for-coding" }));
    const persist = vi.fn();
    const activate = vi.fn();
    await expect(commitVerifiedProviderConnection({
      verify: async () => { throw new Error("invalid membership key"); }, connect, persist, activate,
    })).rejects.toThrow("invalid membership key");
    expect(connect).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
    expect(activate).not.toHaveBeenCalled();
  });

  it("clears an active backend credential before encrypted storage", async () => {
    const order: string[] = [];
    await removeProviderCredential({
      providerId: "kimi",
      active: true,
      clearInMemory: async () => { order.push("memory"); },
      clearCredential: () => { order.push("encrypted"); },
      clearProvider: () => { order.push("provider"); },
    });
    expect(order).toEqual(["memory", "encrypted"]);
  });
});
