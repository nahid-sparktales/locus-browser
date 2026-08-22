import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BrowserDatabase } from "./BrowserDatabase.js";
import { CredentialVault, type CredentialCipher } from "./CredentialVault.js";

const cipher: CredentialCipher = {
  available: () => true,
  encrypt: (value) => new TextEncoder().encode(`sealed:${value}`),
  decrypt: (value) => new TextDecoder().decode(value).replace(/^sealed:/, ""),
};

describe("CredentialVault", () => {
  it("requires a user gesture to save or reveal passwords", () => {
    const database = new BrowserDatabase(join(mkdtempSync(join(tmpdir(), "locus-vault-")), "browser.sqlite"));
    const vault = new CredentialVault(database, cipher);
    expect(() => vault.save("https://example.com/login", "nahid", "secret", false)).toThrow("user gesture");
    const id = vault.save("https://example.com/login", "nahid", "secret", true);
    expect(vault.suggestions("https://example.com/other")).toEqual([{ id, username: "nahid" }]);
    expect(() => vault.reveal("https://example.com", id, false)).toThrow("user gesture");
    expect(vault.reveal("https://example.com", id, true)).toBe("secret");
    const updatedId = vault.save("https://example.com/login", "nahid", "new-secret", true);
    expect(updatedId).toBe(id);
    expect(vault.reveal("https://example.com", id, true)).toBe("new-secret");
    vault.delete(id, true);
    expect(vault.suggestions("https://example.com")).toEqual([]);
    database.close();
  });

  it("isolates credentials by browser profile", () => {
    const database = new BrowserDatabase(join(mkdtempSync(join(tmpdir(), "locus-vault-")), "browser.sqlite"));
    const workProfile = database.createProfile("Work");
    const personal = new CredentialVault(database, cipher, "default");
    const work = new CredentialVault(database, cipher, workProfile.id);
    personal.save("https://example.com", "personal", "one", true);
    work.save("https://example.com", "work", "two", true);

    expect(personal.suggestions("https://example.com")).toMatchObject([{ username: "personal" }]);
    expect(work.suggestions("https://example.com")).toMatchObject([{ username: "work" }]);
    database.close();
  });

  it("refuses insecure non-local origins", () => {
    const database = new BrowserDatabase(join(mkdtempSync(join(tmpdir(), "locus-vault-")), "browser.sqlite"));
    const vault = new CredentialVault(database, cipher);
    expect(() => vault.save("http://example.com", "user", "secret", true)).toThrow("secure origins");
    database.close();
  });
});
