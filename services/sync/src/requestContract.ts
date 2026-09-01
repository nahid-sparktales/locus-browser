import { z } from "zod";

export const MAX_RECORD_BYTES = 2 * 1024 * 1024;

export const RecordSchema = z.object({
  version: z.literal(1).default(1),
  accountId: z.string().min(1).max(128),
  deviceId: z.string().min(1).max(128),
  collection: z.enum(["bookmarks", "history", "tab-groups", "remote-tabs", "settings", "extensions"]),
  recordId: z.string().min(1).max(512),
  clock: z.string().regex(/^\d{13}-\d{6}-[A-Za-z0-9_-]+$/),
  nonce: z.string().min(16).max(128),
  ciphertext: z.string().min(1).max(2_800_000),
  tombstone: z.boolean().default(false),
});

export const PushSchema = z.object({
  keyVersion: z.number().int().positive(),
  records: z.array(RecordSchema).max(500),
});

export const DeviceIdentitySchema = z.object({
  deviceId: z.string().min(8).max(128),
  deviceName: z.string().trim().min(1).max(80),
  devicePublicKey: z.string().min(32).max(512),
});

export const AccountKeyWrapSchema = z.object({
  deviceId: z.string().min(8).max(128),
  wrappedAccountKey: z.string().min(32).max(1_024),
});

export const EnrollmentClaimSchema = z.object({
  enrollmentId: z.string().uuid(),
  approvalCode: z.string().min(20).max(128),
});

export const PasskeyResponseSchema = z.object({
  id: z.string().min(1).max(2_048),
  rawId: z.string().min(1).max(2_048),
  type: z.literal("public-key"),
  response: z.record(z.string(), z.unknown()),
  clientExtensionResults: z.record(z.string(), z.unknown()).default({}),
  authenticatorAttachment: z.string().optional(),
});

export const PasskeyConfigSchema = z.object({
  rpName: z.string().trim().min(1).max(80),
  rpId: z.string().regex(/^(localhost|(?:[A-Za-z0-9-]+\.)*[A-Za-z0-9-]+)$/),
  origin: z.string().url().refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname));
  }, "Passkey origin must use HTTPS except on localhost"),
  callbackScheme: z.string().regex(/^[a-z][a-z0-9+.-]*$/),
});

export const safeRequestErrors = new Set([
  "Device identity collision",
  "Device is unavailable",
  "Enrollment is unavailable",
  "Every active device requires exactly one wrapped account key",
  "Key rotation must replace every sync record",
  "Passkey account mismatch",
  "Passkey is already registered",
  "Passkey is unavailable",
  "Record ownership mismatch",
  "Sync account key is not initialized",
  "Sync account key version changed",
]);
