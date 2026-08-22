import { describe, expect, it } from "vitest";
import { credentialAutofillInvocation, credentialObserverSource, parseCredentialCandidate } from "./CredentialPageBridge.js";

describe("credential page bridge", () => {
  it("builds syntactically valid isolated-world scripts with safely encoded values", () => {
    const observer = credentialObserverSource("__locusCredential_tab_1");
    const autofill = credentialAutofillInvocation('person"@example.com', "secret\n</script>");
    expect(() => new Function(`return ${observer}`)).not.toThrow();
    expect(() => new Function(`return ${autofill}`)).not.toThrow();
    expect(autofill).toContain(JSON.stringify("secret\n</script>"));
  });

  it("accepts only bounded, canonical credential candidates", () => {
    expect(parseCredentialCandidate({ origin: "https://example.com", username: "person", password: "secret" })).toEqual({
      origin: "https://example.com", username: "person", password: "secret",
    });
    expect(parseCredentialCandidate({ origin: "https://example.com/path", username: "person", password: "secret" })).toBeUndefined();
    expect(parseCredentialCandidate({ origin: "https://example.com", username: "person", password: "" })).toBeUndefined();
  });
});
