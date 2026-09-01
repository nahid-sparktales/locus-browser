import sodium from "libsodium-wrappers-sumo";

export async function ready(): Promise<void> {
  await sodium.ready;
}

export function encode(value: Uint8Array): string {
  return sodium.to_base64(value, sodium.base64_variants.URLSAFE_NO_PADDING);
}

export function decode(value: string): Uint8Array {
  return sodium.from_base64(value, sodium.base64_variants.URLSAFE_NO_PADDING);
}
