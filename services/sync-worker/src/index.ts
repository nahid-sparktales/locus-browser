import { PostgresSyncRepository } from "@locus/sync-service/postgres-repository";
import { createSyncRequestHandler } from "@locus/sync-service/request-handler";
import { R2OpaqueBlobStore } from "./r2OpaqueBlobStore.js";

interface Env {
  DEVICE_RATE_LIMITER: RateLimit;
  PUBLIC_RATE_LIMITER: RateLimit;
  SYNC_DATABASE: Hyperdrive;
  SYNC_OBJECTS: R2Bucket;
  LOCUS_PASSKEY_ORIGIN: string;
  LOCUS_PASSKEY_RP_ID: string;
  LOCUS_PASSKEY_RP_NAME?: string;
}

const allowedMethods = new Set(["GET", "POST", "PUT", "DELETE"]);
const orphanCursorKey = "maintenance/orphan-cursor";
const orphanGraceMilliseconds = 24 * 60 * 60 * 1_000;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const requestId = crypto.randomUUID();
    const url = new URL(request.url);
    if (!allowedMethods.has(request.method)) return hardened(json({ error: "Method not allowed" }, 405), requestId);
    const limited = await rateLimit(request, env, url.pathname);
    if (limited) return hardened(limited, requestId);

    let repository: PostgresSyncRepository | undefined;
    try {
      const handler = createSyncRequestHandler({
        passkeyConfig: {
          rpName: env.LOCUS_PASSKEY_RP_NAME || "Locus Sync",
          rpId: requiredBinding(env.LOCUS_PASSKEY_RP_ID, "LOCUS_PASSKEY_RP_ID"),
          origin: requiredBinding(env.LOCUS_PASSKEY_ORIGIN, "LOCUS_PASSKEY_ORIGIN").replace(/\/$/, ""),
          callbackScheme: "locus-browser",
        },
      });
      if (request.method === "GET" && url.pathname === "/ready") {
        repository = createRepository(env);
        await Promise.all([
          repository.readiness(),
          env.SYNC_OBJECTS.head("health/readiness-probe"),
        ]);
        return hardened(json({ ok: true, database: "ready", objectStorage: "ready" }, 200), requestId);
      }
      const response = await handler.fetch(request, async () => {
        repository = createRepository(env);
        return repository;
      });
      if (response.status >= 500) {
        console.error(JSON.stringify({ event: "sync_request_error", method: request.method, path: url.pathname, requestId }));
      }
      return hardened(response, requestId);
    } catch (error) {
      console.error(JSON.stringify({
        event: "sync_request_failed",
        method: request.method,
        path: url.pathname,
        requestId,
        error: error instanceof Error ? error.message : "Unknown error",
      }));
      return hardened(json({ error: "Sync service is temporarily unavailable", requestId }, 503), requestId);
    } finally {
      await repository?.close().catch(() => undefined);
    }
  },
  async scheduled(_controller: ScheduledController, env: Env, context: ExecutionContext): Promise<void> {
    context.waitUntil(reconcileOrphanedObjects(env));
  },
} satisfies ExportedHandler<Env>;

function createRepository(env: Env): PostgresSyncRepository {
  return new PostgresSyncRepository(
    env.SYNC_DATABASE.connectionString,
    new R2OpaqueBlobStore(env.SYNC_OBJECTS),
    { applicationName: "locus-sync-worker", maxConnections: 1 },
  );
}

async function reconcileOrphanedObjects(env: Env): Promise<void> {
  const repository = createRepository(env);
  let examined = 0;
  let removed = 0;
  try {
    const savedCursor = await env.SYNC_OBJECTS.get(orphanCursorKey);
    let cursor = savedCursor ? (await savedCursor.text()).trim() || undefined : undefined;
    const cutoff = Date.now() - orphanGraceMilliseconds;
    for (let page = 0; page < 20; page += 1) {
      const result = await env.SYNC_OBJECTS.list({ prefix: "v1/", limit: 1_000, ...(cursor ? { cursor } : {}) });
      const candidates = result.objects.filter((object) => object.uploaded.getTime() < cutoff).map((object) => object.key);
      examined += result.objects.length;
      const referenced = await repository.referencedObjectKeys(candidates);
      const orphaned = candidates.filter((key) => !referenced.has(key));
      if (orphaned.length) {
        await new R2OpaqueBlobStore(env.SYNC_OBJECTS).delete(orphaned);
        removed += orphaned.length;
      }
      if (!result.truncated) {
        await env.SYNC_OBJECTS.delete(orphanCursorKey);
        cursor = undefined;
        break;
      }
      cursor = result.cursor;
      await env.SYNC_OBJECTS.put(orphanCursorKey, cursor, {
        httpMetadata: { cacheControl: "no-store", contentType: "text/plain; charset=utf-8" },
      });
    }
    console.log(JSON.stringify({ event: "sync_orphan_reconciliation", examined, removed, continuing: Boolean(cursor) }));
  } catch (error) {
    console.error(JSON.stringify({
      event: "sync_orphan_reconciliation_failed",
      examined,
      removed,
      error: error instanceof Error ? error.message : "Unknown error",
    }));
    throw error;
  } finally {
    await repository.close().catch(() => undefined);
  }
}

function requiredBinding(value: string | undefined, name: string): string {
  if (!value?.trim()) throw new Error(`${name} is not configured`);
  return value.trim();
}

async function rateLimit(request: Request, env: Env, path: string): Promise<Response | undefined> {
  if (path === "/health" || path === "/ready" || path.endsWith("/client.js") || path.endsWith("/client.css")) return undefined;
  const authorization = request.headers.get("authorization") ?? "";
  const token = /^Bearer ([A-Za-z0-9_-]{20,})$/.exec(authorization)?.[1];
  const key = token
    ? `${routeFamily(path)}:${await sha256(token)}`
    : `${routeFamily(path)}:${request.headers.get("cf-connecting-ip") ?? "unknown"}`;
  const limiter = token ? env.DEVICE_RATE_LIMITER : env.PUBLIC_RATE_LIMITER;
  const result = await limiter.limit({ key });
  if (result.success) return undefined;
  return new Response(JSON.stringify({ error: "Too many requests" }), {
    status: 429,
    headers: { "content-type": "application/json; charset=utf-8", "retry-after": "60" },
  });
}

function routeFamily(path: string): string {
  if (path.startsWith("/v1/auth/passkeys/")) return "passkeys";
  if (path.startsWith("/v1/devices/enrollments")) return "enrollments";
  if (path.startsWith("/v1/sync/")) return "sync";
  return "account";
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hardened(response: Response, requestId: string): Response {
  const headers = new Headers(response.headers);
  headers.set("permissions-policy", "camera=(), geolocation=(), microphone=(), payment=(), usb=()");
  headers.set("strict-transport-security", "max-age=31536000; includeSubDomains");
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-request-id", requestId);
  if (!headers.has("cache-control")) headers.set("cache-control", "no-store");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
