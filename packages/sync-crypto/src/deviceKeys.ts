import { randomBytes } from "node:crypto";
import sodium from "libsodium-wrappers-sumo";
import { decode, encode, ready } from "./encoding.js";

export interface DeviceKeyPair {
  publicKey: string;
  privateKey: string;
}

export async function generateAccountKey(): Promise<string> {
  await ready();
  return encode(sodium.randombytes_buf(32));
}

export async function generateDeviceKeyPair(): Promise<DeviceKeyPair> {
  await ready();
  const pair = sodium.crypto_box_keypair();
  return { publicKey: encode(pair.publicKey), privateKey: encode(pair.privateKey) };
}

export async function wrapAccountKey(accountKey: string, devicePublicKey: string): Promise<string> {
  await ready();
  return encode(sodium.crypto_box_seal(decode(accountKey), decode(devicePublicKey)));
}

export async function unwrapAccountKey(wrapped: string, device: DeviceKeyPair): Promise<string> {
  await ready();
  const opened = sodium.crypto_box_seal_open(decode(wrapped), decode(device.publicKey), decode(device.privateKey));
  if (!opened) throw new Error("Could not unwrap the account sync key");
  return encode(opened);
}

export function randomDeviceId(): string {
  return randomBytes(12).toString("base64url");
}
