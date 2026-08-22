import { randomUUID } from "node:crypto";
import type { BrowserDatabase } from "./BrowserDatabase.js";

export interface CredentialCipher {
  available(): boolean;
  encrypt(value: string): Uint8Array;
  decrypt(value: Uint8Array): string;
}

export interface CredentialSuggestion {
  id: string;
  username: string;
}

export class CredentialVault {
  constructor(readonly database: BrowserDatabase, readonly cipher: CredentialCipher) {}

  suggestions(rawOrigin: string): CredentialSuggestion[] {
    const origin = safeOrigin(rawOrigin);
    return this.database.credentialsForOrigin(origin).map(({ id, username }) => ({ id, username }));
  }

  save(rawOrigin: string, username: string, password: string, userGesture: boolean): string {
    requireUserGesture(userGesture);
    if (!this.cipher.available()) throw new Error("OS-backed password encryption is unavailable");
    if (!password) throw new Error("Password cannot be empty");
    const id = randomUUID();
    this.database.saveCredential({
      id,
      origin: safeOrigin(rawOrigin),
      username: username.slice(0, 512),
      encryptedPassword: this.cipher.encrypt(password),
    });
    return id;
  }

  reveal(rawOrigin: string, id: string, userGesture: boolean): string {
    requireUserGesture(userGesture);
    const credential = this.database.credentialsForOrigin(safeOrigin(rawOrigin)).find((item) => item.id === id);
    if (!credential) throw new Error("Credential is unavailable for this site");
    return this.cipher.decrypt(credential.encryptedPassword);
  }
}

function requireUserGesture(userGesture: boolean): void {
  if (!userGesture) throw new Error("A user gesture is required before password autofill");
}

function safeOrigin(raw: string): string {
  const url = new URL(raw);
  if (url.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    throw new Error("Passwords can only be saved for secure origins");
  }
  return url.origin;
}
