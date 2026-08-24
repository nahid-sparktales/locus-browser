import { describe, expect, it, vi } from "vitest";
import { createGalleryRequestHandler, type GalleryWorkerDependencies } from "./index.js";

const fingerprint = "a".repeat(64);
const packageBytes = new TextEncoder().encode("verified extension package");
const packageSha256 = "6e3e9376d2bedb0268cdeb68fe9dd48c93d74a54db037a0561f02eb1dc4c79e8";

class MemoryBucket {
  readonly objects = new Map<string, Uint8Array>();

  put(key: string, value: string | Uint8Array): void {
    this.objects.set(key, typeof value === "string" ? new TextEncoder().encode(value) : value);
  }

  async head(key: string) {
    const bytes = this.objects.get(key);
    return bytes ? { size: bytes.byteLength, httpEtag: `"memory-${bytes.byteLength}"` } : null;
  }

  async get(key: string) {
    const bytes = this.objects.get(key);
    if (!bytes) return null;
    return {
      body: new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer]).stream(),
      size: bytes.byteLength,
      httpEtag: `"memory-${bytes.byteLength}"`,
      text: async () => new TextDecoder().decode(bytes),
    };
  }
}

describe("Cloudflare extension gallery", () => {
  it("serves signed metadata and reports dependency readiness", async () => {
    const { env } = fixture();
    const handler = createGalleryRequestHandler();
    const health = await handler(new Request("https://extensions.example/health"), env);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true, extensions: 1, catalog: "ready", revocations: "ready", storage: "ready" });
    expect(health.headers.get("strict-transport-security")).toContain("includeSubDomains");

    const catalog = await handler(new Request("https://extensions.example/v1/extensions"), env);
    expect(catalog.status).toBe(200);
    expect((await catalog.json() as { kind: string }).kind).toBe("catalog");
    const conditional = await handler(new Request("https://extensions.example/v1/extensions", {
      headers: { "if-none-match": catalog.headers.get("etag") ?? "" },
    }), env);
    expect(conditional.status).toBe(304);
  });

  it("streams only catalogued immutable packages with signed integrity metadata", async () => {
    const { env } = fixture();
    const handler = createGalleryRequestHandler();
    const response = await handler(new Request("https://extensions.example/v1/extensions/com.example.notes/1.2.3/download"), env);
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(packageBytes);
    expect(response.headers.get("etag")).toBe(`"sha256-${packageSha256}"`);
    expect(response.headers.get("digest")).toMatch(/^sha-256=:[A-Za-z0-9+/]+=*:$/);
    expect(response.headers.get("cache-control")).toContain("immutable");

    const head = await handler(new Request(response.url || "https://extensions.example/v1/extensions/com.example.notes/1.2.3/download", { method: "HEAD" }), env);
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
  });

  it("rejects writes, unknown packages, range requests, and exhausted clients", async () => {
    const { env } = fixture();
    const handler = createGalleryRequestHandler();
    expect((await handler(new Request("https://extensions.example/v1/extensions", { method: "POST" }), env)).status).toBe(405);
    expect((await handler(new Request("https://extensions.example/v1/extensions/com.example.missing/1.0.0/download"), env)).status).toBe(404);
    expect((await handler(new Request("https://extensions.example/v1/extensions/com.example.notes/1.2.3/download", { headers: { range: "bytes=0-1" } }), env)).status).toBe(416);
    env.PUBLIC_RATE_LIMITER = { limit: vi.fn(async () => ({ success: false })) };
    const limited = await handler(new Request("https://extensions.example/v1/extensions"), env);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
  });

  it("fails closed when signed metadata is absent or has the wrong fingerprint", async () => {
    const { env, bucket } = fixture();
    const handler = createGalleryRequestHandler();
    bucket.put("metadata/catalog.json", JSON.stringify(catalogDocument("b".repeat(64))));
    const response = await handler(new Request("https://extensions.example/health"), env);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "Extension gallery is temporarily unavailable" });
  });
});

function fixture(): { env: GalleryWorkerDependencies; bucket: MemoryBucket } {
  const bucket = new MemoryBucket();
  bucket.put("metadata/catalog.json", JSON.stringify(catalogDocument(fingerprint)));
  bucket.put("metadata/revocations.json", JSON.stringify(revocationsDocument(fingerprint)));
  bucket.put("packages/com.example.notes/1.2.3/com.example.notes-1.2.3.locusx", packageBytes);
  return {
    bucket,
    env: {
      GALLERY_OBJECTS: bucket,
      LOCUS_GALLERY_FINGERPRINT: fingerprint,
      PUBLIC_RATE_LIMITER: { limit: vi.fn(async () => ({ success: true })) },
    },
  };
}

function catalogDocument(signer: string) {
  return {
    documentVersion: 1,
    kind: "catalog",
    payload: {
      catalogVersion: 1,
      packageContractVersion: 2,
      extensions: [{
        id: "com.example.notes",
        name: "Notes",
        version: "1.2.3",
        publisherFingerprint: "c".repeat(64),
        galleryFingerprint: signer,
        packageSha256,
        packageSize: packageBytes.byteLength,
        permissions: [],
        hostPermissions: [],
        downloadPath: "/v1/extensions/com.example.notes/1.2.3/download",
      }],
    },
    signature: { algorithm: "Ed25519", publicKeyPem: "public", fingerprint: signer, value: "c2lnbmF0dXJl" },
  };
}

function revocationsDocument(signer: string) {
  return {
    documentVersion: 1,
    kind: "revocations",
    payload: { version: 1, generatedAt: 1, revocations: [] },
    signature: { algorithm: "Ed25519", publicKeyPem: "public", fingerprint: signer, value: "c2lnbmF0dXJl" },
  };
}
