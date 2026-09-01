import { describe, expect, it, vi } from "vitest";
import { publicationScopeForCommand, SurfaceStatePublisher } from "./SurfaceStatePublisher.js";

describe("SurfaceStatePublisher", () => {
  it("keeps Work-local commands off the shell publication path", () => {
    expect(publicationScopeForCommand({ type: "set-work-panel", panel: "files" })).toBe("work");
    expect(publicationScopeForCommand({ type: "refresh-work-files" })).toBe("work");
    expect(publicationScopeForCommand({ type: "work-send", text: "Hello" })).toBe("both");
  });

  it("coalesces repeated requests for the same surface", async () => {
    const publish = vi.fn();
    const publisher = new SurfaceStatePublisher(publish);

    publisher.request("work");
    publisher.request("work");
    await Promise.resolve();

    expect(publish).toHaveBeenCalledTimes(1);
    expect([...publish.mock.calls[0]![0]]).toEqual(["work"]);
  });

  it("merges shell and work requests made in one turn", async () => {
    const publish = vi.fn();
    const publisher = new SurfaceStatePublisher(publish);

    publisher.request("shell");
    publisher.request("work");
    await Promise.resolve();

    expect(publish).toHaveBeenCalledTimes(1);
    expect([...publish.mock.calls[0]![0]].sort()).toEqual(["shell", "work"]);
  });
});
