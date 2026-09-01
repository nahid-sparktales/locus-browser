import sodium from "libsodium-wrappers-sumo";
import { decode, encode, ready } from "./encoding.js";

export interface LocalEncryptedValue {
  version: 1;
  nonce: string;
  ciphertext: string;
}

export async function generateLocalEncryptionKey(): Promise<string> {
  await ready();
  return encode(sodium.randombytes_buf(32));
}

export async function encryptLocalValue(key: string, context: string, value: string): Promise<LocalEncryptedValue> {
  await ready();
  const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    new TextEncoder().encode(value),
    new TextEncoder().encode(context),
    null,
    nonce,
    decode(key),
  );
  return { version: 1, nonce: encode(nonce), ciphertext: encode(ciphertext) };
}

export async function decryptLocalValue(key: string, context: string, value: LocalEncryptedValue): Promise<string> {
  await ready();
  if (value.version !== 1) throw new Error("Unsupported local encryption version");
  const plaintext = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
    null,
    decode(value.ciphertext),
    new TextEncoder().encode(context),
    decode(value.nonce),
    decode(key),
  );
  return new TextDecoder().decode(plaintext);
}
