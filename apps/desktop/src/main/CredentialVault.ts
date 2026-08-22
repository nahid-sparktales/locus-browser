import { randomUUID } from "node:crypto";
import type { BrowserDatabase, StoredCredentialMetadata } from "./BrowserDatabase.js";

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
  constructor(readonly database: BrowserDatabase, readonly cipher: CredentialCipher, readonly profileId = "default") {}

  available(): boolean {
    return this.cipher.available();
  }

  suggestions(rawOrigin: string): CredentialSuggestion[] {
    const origin = safeOrigin(rawOrigin);
    return this.database.credentialsForOrigin(this.profileId, origin).map(({ id, username }) => ({ id, username }));
  }

  list(): StoredCredentialMetadata[] {
    return this.database.listCredentials(this.profileId);
  }

  save(rawOrigin: string, username: string, password: string, userGesture: boolean): string {
    requireUserGesture(userGesture);
    if (!this.cipher.available()) throw new Error("OS-backed password encryption is unavailable");
    if (!password) throw new Error("Password cannot be empty");
    const origin = safeOrigin(rawOrigin);
    const normalizedUsername = username.trim().slice(0, 512);
    const id = this.database.credentialsForOrigin(this.profileId, origin)
      .find((credential) => credential.username === normalizedUsername)?.id ?? randomUUID();
    this.database.saveCredential(this.profileId, {
      id,
      origin,
      username: normalizedUsername,
      encryptedPassword: this.cipher.encrypt(password),
    });
    return id;
  }

  reveal(rawOrigin: string, id: string, userGesture: boolean): string {
    requireUserGesture(userGesture);
    const credential = this.database.credentialsForOrigin(this.profileId, safeOrigin(rawOrigin)).find((item) => item.id === id);
    if (!credential) throw new Error("Credential is unavailable for this site");
    return this.cipher.decrypt(credential.encryptedPassword);
  }

  delete(id: string, userGesture: boolean): void {
    requireUserGesture(userGesture);
    this.database.deleteCredential(this.profileId, id);
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
