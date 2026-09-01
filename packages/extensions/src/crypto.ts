import { createHash } from "node:crypto";

export function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function publicKeyFingerprint(publicKeyPem: string): string {
  return sha256(Buffer.from(publicKeyPem.replace(/\s+/g, "")));
}
