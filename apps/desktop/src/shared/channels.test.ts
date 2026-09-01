import { describe, expect, it } from "vitest";
import { ipcChannels } from "./channels.js";

describe("renderer state channels", () => {
  it("keeps shell and Work state paths distinct", () => {
    expect(ipcChannels).not.toHaveProperty("getState");
    expect(ipcChannels).not.toHaveProperty("state");
    expect(new Set(Object.values(ipcChannels)).size).toBe(Object.values(ipcChannels).length);
    expect(ipcChannels.getShellState).not.toBe(ipcChannels.getWorkState);
    expect(ipcChannels.shellState).not.toBe(ipcChannels.workState);
  });
});
