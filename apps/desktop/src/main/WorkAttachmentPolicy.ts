export const MAX_WORK_ATTACHMENTS = 10;
export const MAX_WORK_ATTACHMENT_BYTES = 15 * 1024 * 1024;
export const MAX_WORK_ATTACHMENT_TOTAL_BYTES = 25 * 1024 * 1024;

export type WorkImageMimeType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

export function detectImageMimeType(bytes: Uint8Array): WorkImageMimeType | undefined {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) || startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])) return "image/gif";
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  return undefined;
}

export function attachmentBudgetIssue(existingSizes: number[], candidateSizes: number[]): string | undefined {
  if (existingSizes.length + candidateSizes.length > MAX_WORK_ATTACHMENTS) return "A message can include up to 10 images.";
  if (candidateSizes.some((size) => size > MAX_WORK_ATTACHMENT_BYTES)) return "Each image must be 15 MB or smaller.";
  const total = [...existingSizes, ...candidateSizes].reduce((sum, size) => sum + size, 0);
  if (total > MAX_WORK_ATTACHMENT_TOTAL_BYTES) return "The attached images must total 25 MB or less.";
  return undefined;
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}
