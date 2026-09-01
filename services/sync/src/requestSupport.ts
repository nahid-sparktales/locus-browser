import { createHash } from "node:crypto";
import { z } from "zod";
import { RecordSchema } from "./requestContract.js";
import type { AuthenticatedDevice, OpaqueSyncRecord } from "./types.js";

const MAX_BODY_BYTES = 3 * 1024 * 1024;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function isPublicRoute(method: string, path: string): boolean {
  return path === "/health"
    || (method === "POST" && path === "/v1/devices/enrollments")
    || path === "/v1/devices/enrollments/claim"
    || path.startsWith("/v1/auth/passkeys/");
}

export function bearerToken(authorization: string | null): string {
  const match = /^Bearer ([A-Za-z0-9_-]{20,})$/.exec(authorization ?? "");
  return match?.[1] ?? "";
}

export function requiredDevice(device: AuthenticatedDevice | undefined): AuthenticatedDevice {
  if (!device) throw new Error("Device authentication required");
  return device;
}

export function route(path: string, pattern: RegExp): RegExpExecArray | null {
  return pattern.exec(path);
}

export async function requestBody(request: Request): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) throw new RequestSizeError();
  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_BODY_BYTES) throw new RequestSizeError();
  if (!body.byteLength) return undefined;
  try {
    return JSON.parse(new TextDecoder().decode(body));
  } catch {
    throw new RequestValidationError("Invalid JSON request");
  }
}

export function syncRecords(records: z.infer<typeof RecordSchema>[]): OpaqueSyncRecord[] {
  return records.map((record) => ({ ...record, size: Buffer.byteLength(record.ciphertext, "base64url") }));
}

export function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...Object.fromEntries(new Headers(headers)) },
  });
}

export function text(body: string, status = 200, headers: HeadersInit = {}): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", ...Object.fromEntries(new Headers(headers)) },
  });
}

export class RequestSizeError extends Error {
  constructor() {
    super("Request body exceeds 3 MB");
  }
}

export class RequestValidationError extends Error {}
