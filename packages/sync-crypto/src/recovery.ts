import { createHash } from "node:crypto";
import { decode, encode } from "./encoding.js";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function createRecoveryKey(accountKey: string): string {
  const raw = Buffer.from(decode(accountKey));
  if (raw.byteLength !== 32) throw new Error("Account key must contain 32 bytes");
  const checksum = createHash("sha256").update(raw).digest().subarray(0, 4);
  const encoded = encodeBase32(Buffer.concat([raw, checksum]));
  return `LOCUS-${encoded.match(/.{1,5}/g)!.join("-")}`;
}

export function recoverAccountKey(recoveryKey: string): string {
  const normalized = recoveryKey.toUpperCase().replace(/^LOCUS-/, "").replace(/-/g, "");
  const decoded = decodeBase32(normalized);
  if (decoded.byteLength !== 36) throw new Error("Recovery key has the wrong length");
  const raw = decoded.subarray(0, 32);
  const supplied = decoded.subarray(32);
  const expected = createHash("sha256").update(raw).digest().subarray(0, 4);
  if (!expected.equals(supplied)) throw new Error("Recovery key checksum is invalid");
  return encode(raw);
}

function encodeBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}

function decodeBase32(value: string): Buffer {
  let bits = 0;
  let accumulator = 0;
  const output: number[] = [];
  for (const character of value) {
    const index = BASE32.indexOf(character);
    if (index < 0) throw new Error("Recovery key contains an invalid character");
    accumulator = (accumulator << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((accumulator >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}
