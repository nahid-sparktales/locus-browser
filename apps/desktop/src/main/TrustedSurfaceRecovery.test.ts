import { describe, expect, it } from "vitest";
import { trustedSurfaceRecovery } from "./TrustedSurfaceRecovery.js";

describe("trusted renderer crash recovery", () => {
  it("recovers three crashes with backoff and stops a crash loop", () => {
    let crashes: number[] = [];
    for (let index = 1; index <= 3; index += 1) {
      const decision = trustedSurfaceRecovery(crashes, 10_000 + index);
      crashes = decision.crashes;
      expect(decision.recover).toBe(true);
      expect(decision.delayMs).toBe(index * 150);
    }
    expect(trustedSurfaceRecovery(crashes, 10_004).recover).toBe(false);
    expect(trustedSurfaceRecovery(crashes, 80_000)).toMatchObject({ recover: true, crashes: [80_000] });
  });
});
