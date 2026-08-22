import { safeStorage } from "electron";
import type { CredentialCipher } from "./CredentialVault.js";

export const electronCredentialCipher: CredentialCipher = {
  available: () => safeStorage.isEncryptionAvailable(),
  encrypt: (value) => safeStorage.encryptString(value),
  decrypt: (value) => safeStorage.decryptString(Buffer.from(value)),
};
