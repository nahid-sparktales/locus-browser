import { KIMI_MEMBERSHIP_BASE_URL, KIMI_MEMBERSHIP_MODELS } from "./WorkModelProviders.js";

const KIMI_CHAT_COMPLETIONS_URL = `${KIMI_MEMBERSHIP_BASE_URL}/chat/completions`;

export async function probeKimiMembership(
  apiKey: string,
  model: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  if (!apiKey.trim()) throw new Error("Kimi Membership requires a membership API key");
  if (!KIMI_MEMBERSHIP_MODELS.some((candidate) => candidate === model)) {
    throw new Error("Choose a supported Kimi Code membership model");
  }

  let response: Response;
  try {
    response = await fetchImpl(KIMI_CHAT_COMPLETIONS_URL, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "User-Agent": "Locus-Browser/1.0",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "Reply with OK." }],
        max_tokens: 8,
        stream: false,
      }),
    });
  } catch {
    throw new Error("Could not reach the Kimi Code membership service");
  }

  if (response.ok) return;
  if (response.status === 401) throw new Error("Kimi rejected this membership key. Create a Kimi Code API key in the membership console.");
  if (response.status === 403 && model === "kimi-for-coding-highspeed") {
    throw new Error("Kimi HighSpeed requires an Allegretto or higher membership plan.");
  }
  if (response.status === 403) throw new Error("This Kimi membership does not allow Kimi Code API access.");
  if (response.status === 429) throw new Error("Kimi membership usage is temporarily exhausted. Check the reset time in the Kimi console.");
  throw new Error(`Kimi membership verification failed (${response.status})`);
}
