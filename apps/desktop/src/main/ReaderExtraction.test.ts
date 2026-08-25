import { describe, expect, it } from "vitest";
import { extractReadableArticle } from "./ReaderExtraction.js";

const paragraph = "Private browsing intelligence should keep page context encrypted on the device, preserve explicit user authority, and cite the exact evidence used for factual claims. ";

describe("Reader extraction", () => {
  it("uses Readability, resolves safe links and applies a second strict sanitizer", () => {
    const result = extractReadableArticle(`<!doctype html><html lang="en"><head><title>Private browser design</title></head><body>
      <article><h1>Private browser design</h1><p>${paragraph.repeat(4)}</p>
      <a href="/architecture" onclick="steal()">Architecture</a>
      <a href="javascript:steal()">Unsafe link</a><form><input value="secret"></form><script>steal()</script></article>
    </body></html>`, "https://locushost.co/guide", "Fallback");
    expect(result?.title).toContain("Private browser design");
    expect(result?.html).toContain('href="https://locushost.co/architecture"');
    expect(result?.html).not.toMatch(/javascript:|onclick|<script|<form|<input|secret/);
    expect(result?.text.length).toBeGreaterThan(350);
  });

  it("declines pages that do not meet the readable-article threshold", () => {
    expect(extractReadableArticle("<html><body><p>Too short.</p></body></html>", "https://example.com", "Short")).toBeUndefined();
  });
});
