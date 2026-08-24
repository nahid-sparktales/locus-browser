interface RateLimitDependency {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

interface GalleryR2Object {
  body: ReadableStream;
  httpEtag: string;
  size: number;
  text(): Promise<string>;
}

interface GalleryR2Head {
  httpEtag: string;
  size: number;
}

interface GalleryStorageDependency {
  get(key: string): Promise<GalleryR2Object | null>;
  head(key: string): Promise<GalleryR2Head | null>;
}

export interface GalleryWorkerDependencies {
  GALLERY_OBJECTS: GalleryStorageDependency;
  LOCUS_GALLERY_FINGERPRINT: string;
  PUBLIC_RATE_LIMITER: RateLimitDependency;
}

interface CatalogEntry {
  id: string;
  version: string;
  packageSha256: string;
  packageSize: number;
  downloadPath: string;
}

interface SignedCatalog {
  payload: { extensions: CatalogEntry[] };
  signature: { fingerprint: string };
}

const catalogKey = "metadata/catalog.json";
const revocationsKey = "metadata/revocations.json";
const maxCatalogBytes = 512 * 1024;
const maxRevocationsBytes = 2 * 1024 * 1024;
const extensionId = /^[a-z0-9](?:[a-z0-9.-]{1,126}[a-z0-9])?$/;
const extensionVersion = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const sha256Hex = /^[a-f0-9]{64}$/;

export function createGalleryRequestHandler() {
  return async (request: Request, env: GalleryWorkerDependencies): Promise<Response> => {
    const requestId = crypto.randomUUID();
    const url = new URL(request.url);
    try {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return hardened(json({ error: "Method not allowed" }, 405), requestId);
      }
      if (url.pathname !== "/health") {
        const limited = await env.PUBLIC_RATE_LIMITER.limit({
          key: request.headers.get("cf-connecting-ip") || "unknown",
        });
        if (!limited.success) {
          return hardened(json({ error: "Too many requests" }, 429, { "retry-after": "60" }), requestId);
        }
      }

      if (url.pathname === "/health") {
        const [catalog, revocations] = await Promise.all([
          loadCatalog(env),
          loadRevocations(env),
        ]);
        return hardened(json({
          ok: true,
          extensions: catalog.value.payload.extensions.length,
          catalog: "ready",
          revocations: revocations ? "ready" : "unavailable",
          storage: "ready",
        }, 200, undefined, request.method === "HEAD"), requestId);
      }
      if (url.pathname === "/v1/extensions") {
        const catalog = await loadCatalog(env);
        return hardened(documentResponse(request, catalog), requestId);
      }
      if (url.pathname === "/v1/revocations") {
        const revocations = await loadRevocations(env);
        return hardened(documentResponse(request, revocations), requestId);
      }

      const match = /^\/v1\/extensions\/([^/]+)\/([^/]+)\/download$/.exec(url.pathname);
      if (!match) return hardened(json({ error: "Not found" }, 404), requestId);
      const id = match[1] ?? "";
      const version = match[2] ?? "";
      if (!extensionId.test(id) || !extensionVersion.test(version)) {
        return hardened(json({ error: "Not found" }, 404), requestId);
      }
      const catalog = await loadCatalog(env);
      const entry = catalog.value.payload.extensions.find((item) => item.id === id && item.version === version);
      if (!entry) return hardened(json({ error: "Extension package not found" }, 404), requestId);
      if (request.headers.has("range")) {
        return hardened(json({ error: "Range requests are not supported" }, 416), requestId);
      }
      const etag = `"sha256-${entry.packageSha256}"`;
      if (request.headers.get("if-none-match") === etag) {
        return hardened(new Response(null, { status: 304, headers: packageHeaders(entry, etag) }), requestId);
      }
      const object = await env.GALLERY_OBJECTS.get(packageKey(entry));
      if (!object) return hardened(json({ error: "Extension package not found" }, 404), requestId);
      if (object.size !== entry.packageSize) throw new Error("Stored extension package size does not match the signed catalog");
      const headers = packageHeaders(entry, etag);
      return hardened(new Response(request.method === "HEAD" ? null : object.body, { status: 200, headers }), requestId);
    } catch (error) {
      console.error(JSON.stringify({
        event: "extension_gallery_request_failed",
        method: request.method,
        path: url.pathname,
        requestId,
        error: error instanceof Error ? error.message : "Unknown error",
      }));
      return hardened(json({ error: "Extension gallery is temporarily unavailable", requestId }, 503), requestId);
    }
  };
}

const handleRequest = createGalleryRequestHandler();

export default {
  async fetch(request, env): Promise<Response> {
    return handleRequest(request, env);
  },
} satisfies ExportedHandler<GalleryWorkerBindings>;

async function loadCatalog(env: GalleryWorkerDependencies): Promise<LoadedDocument<SignedCatalog>> {
  const document = await loadDocument(env.GALLERY_OBJECTS, catalogKey, maxCatalogBytes);
  const value = document.value as Record<string, unknown>;
  assertDocumentEnvelope(value, "catalog", env.LOCUS_GALLERY_FINGERPRINT);
  const payload = record(value.payload, "Catalog payload is invalid");
  if (payload.catalogVersion !== 1 || payload.packageContractVersion !== 2 || !Array.isArray(payload.extensions) || payload.extensions.length > 500) {
    throw new Error("Catalog payload is invalid");
  }
  const ids = new Set<string>();
  const extensions = payload.extensions.map((candidate) => {
    const item = record(candidate, "Catalog extension is invalid");
    const id = string(item.id);
    const version = string(item.version);
    const packageSha256 = string(item.packageSha256);
    const packageSize = item.packageSize;
    const downloadPath = string(item.downloadPath);
    if (!extensionId.test(id) || ids.has(id) || !extensionVersion.test(version) || !sha256Hex.test(packageSha256)
      || !Number.isInteger(packageSize) || Number(packageSize) <= 0 || Number(packageSize) > 50 * 1024 * 1024
      || downloadPath !== `/v1/extensions/${id}/${version}/download`) {
      throw new Error("Catalog extension is invalid");
    }
    ids.add(id);
    return { id, version, packageSha256, packageSize: Number(packageSize), downloadPath };
  });
  return {
    ...document,
    value: {
      payload: { extensions },
      signature: { fingerprint: env.LOCUS_GALLERY_FINGERPRINT },
    },
  };
}

async function loadRevocations(env: GalleryWorkerDependencies): Promise<LoadedDocument<unknown>> {
  const document = await loadDocument(env.GALLERY_OBJECTS, revocationsKey, maxRevocationsBytes);
  const value = document.value as Record<string, unknown>;
  assertDocumentEnvelope(value, "revocations", env.LOCUS_GALLERY_FINGERPRINT);
  const payload = record(value.payload, "Revocation payload is invalid");
  if (payload.version !== 1 || !Array.isArray(payload.revocations) || payload.revocations.length > 10_000) {
    throw new Error("Revocation payload is invalid");
  }
  return document;
}

interface LoadedDocument<T> {
  etag: string;
  serialized: string;
  value: T;
}

async function loadDocument(bucket: GalleryStorageDependency, key: string, maxBytes: number): Promise<LoadedDocument<unknown>> {
  const head = await bucket.head(key);
  if (!head || head.size <= 0 || head.size > maxBytes) throw new Error(`Required gallery document is unavailable: ${key}`);
  const object = await bucket.get(key);
  if (!object || object.size !== head.size) throw new Error(`Gallery document changed while loading: ${key}`);
  const serialized = await object.text();
  if (new TextEncoder().encode(serialized).byteLength !== object.size) throw new Error(`Gallery document size is inconsistent: ${key}`);
  return { etag: head.httpEtag, serialized, value: JSON.parse(serialized) };
}

function assertDocumentEnvelope(value: Record<string, unknown>, kind: "catalog" | "revocations", fingerprint: string): void {
  const signature = record(value.signature, "Gallery document signature is invalid");
  if (value.documentVersion !== 1 || value.kind !== kind || signature.algorithm !== "Ed25519"
    || signature.fingerprint !== fingerprint || !/^[A-Za-z0-9+/]+={0,2}$/.test(string(signature.value))) {
    throw new Error("Gallery document signature is invalid");
  }
}

function documentResponse(request: Request, document: LoadedDocument<unknown>): Response {
  const headers = new Headers({
    "cache-control": "public, max-age=60, stale-if-error=3600",
    "content-length": String(new TextEncoder().encode(document.serialized).byteLength),
    "content-type": "application/json; charset=utf-8",
    etag: document.etag,
  });
  if (request.headers.get("if-none-match") === document.etag) return new Response(null, { status: 304, headers });
  return new Response(request.method === "HEAD" ? null : document.serialized, { status: 200, headers });
}

function packageHeaders(entry: CatalogEntry, etag: string): Headers {
  return new Headers({
    "cache-control": "public, max-age=31536000, immutable",
    "content-disposition": `attachment; filename="${entry.id}-${entry.version}.locusx"`,
    "content-length": String(entry.packageSize),
    "content-type": "application/vnd.locus.extension+zip",
    digest: `sha-256=:${hexToBase64(entry.packageSha256)}:`,
    etag,
  });
}

function packageKey(entry: CatalogEntry): string {
  return `packages/${entry.id}/${entry.version}/${entry.id}-${entry.version}.locusx`;
}

function hexToBase64(value: string): string {
  let binary = "";
  for (let index = 0; index < value.length; index += 2) binary += String.fromCharCode(Number.parseInt(value.slice(index, index + 2), 16));
  return btoa(binary);
}

function hardened(response: Response, requestId: string): Response {
  const headers = new Headers(response.headers);
  headers.set("content-security-policy", "default-src 'none'; frame-ancestors 'none'; sandbox");
  headers.set("cross-origin-resource-policy", "same-origin");
  headers.set("permissions-policy", "camera=(), geolocation=(), microphone=(), payment=(), usb=()");
  headers.set("referrer-policy", "no-referrer");
  headers.set("strict-transport-security", "max-age=31536000; includeSubDomains");
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-request-id", requestId);
  if (!headers.has("cache-control")) headers.set("cache-control", "no-store");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function json(body: unknown, status: number, extraHeaders?: Record<string, string>, head = false): Response {
  const serialized = JSON.stringify(body);
  return new Response(head ? null : serialized, {
    status,
    headers: {
      "content-length": String(new TextEncoder().encode(serialized).byteLength),
      "content-type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
  });
}

function record(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}
