import { describe, expect, it, vi } from "vitest";
import { probeKimiMembership } from "./KimiMembershipProbe.js";

describe("probeKimiMembership", () => {
  it("uses a minimal non-redirecting Chat Completions request", async () => {
    const requests: Array<{ url: string | URL | Request; init: RequestInit | undefined }> = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url, init });
      return new Response("{}", { status: 200 });
    });
    await probeKimiMembership("temporary-key", "kimi-for-coding", fetchImpl as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const { url, init } = requests[0]!;
    expect(url).toBe("https://api.kimi.com/coding/v1/chat/completions");
    expect(init?.redirect).toBe("error");
    expect(JSON.parse(String(init?.body))).toMatchObject({ model: "kimi-for-coding", stream: false, max_tokens: 8 });
  });

  it("returns a clear tier error without exposing response or key material", async () => {
    const fetchImpl = vi.fn(async () => new Response("temporary-key private upstream detail", { status: 403 }));
    await expect(probeKimiMembership("temporary-key", "kimi-for-coding-highspeed", fetchImpl as typeof fetch))
      .rejects.toThrow("Allegretto or higher");
    await probeKimiMembership("temporary-key", "kimi-for-coding-highspeed", fetchImpl as typeof fetch).catch((error: Error) => {
      expect(error.message).not.toContain("temporary-key");
      expect(error.message).not.toContain("private upstream detail");
    });
  });
});
