import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import type { DirectoryExtensionGallery } from "./repository.js";
import type { GalleryPublication } from "./publication.js";

const PackageParamsSchema = z.object({
  id: z.string().min(1).max(128),
  version: z.string().min(1).max(64),
}).strict();

export interface GalleryAppOptions {
  production?: boolean;
  requestsPerMinute?: number;
}

export function createExtensionGalleryApp(
  gallery: DirectoryExtensionGallery,
  publication: GalleryPublication,
  options: GalleryAppOptions = {},
): FastifyInstance {
  const server = Fastify({ logger: false, bodyLimit: 32 * 1024, trustProxy: false });
  const limits = new Map<string, { minute: number; count: number }>();
  let lastPrunedMinute = -1;

  server.addHook("onRequest", async (request, reply) => {
    const minute = Math.floor(Date.now() / 60_000);
    if (minute !== lastPrunedMinute) {
      for (const [address, counter] of limits) if (counter.minute < minute) limits.delete(address);
      lastPrunedMinute = minute;
    }
    const current = limits.get(request.ip);
    if (!current && limits.size >= 10_000) {
      return reply.header("retry-after", 60).code(429).send({ error: "Rate limit capacity exceeded" });
    }
    const counter = current?.minute === minute ? current : { minute, count: 0 };
    counter.count += 1;
    limits.set(request.ip, counter);
    const limit = options.requestsPerMinute ?? (options.production ? 120 : 10_000);
    reply.header("x-ratelimit-limit", limit).header("x-ratelimit-remaining", Math.max(0, limit - counter.count));
    if (counter.count > limit) return reply.header("retry-after", 60).code(429).send({ error: "Rate limit exceeded" });
  });

  server.addHook("onSend", async (_request, reply, payload) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("referrer-policy", "no-referrer");
    reply.header("content-security-policy", "default-src 'none'; frame-ancestors 'none'; sandbox");
    reply.header("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
    reply.header("cross-origin-resource-policy", "same-origin");
    if (options.production) reply.header("strict-transport-security", "max-age=31536000; includeSubDomains");
    return payload;
  });

  server.get("/health", async () => ({ ok: true, extensions: gallery.catalog().extensions.length }));

  server.get("/v1/extensions", async (request, reply) => {
    const serialized = JSON.stringify(publication.catalog);
    const etag = `"sha256-${createHash("sha256").update(serialized).digest("base64url")}"`;
    if (request.headers["if-none-match"] === etag) return reply.code(304).send();
    return reply
      .header("cache-control", "public, max-age=300, stale-if-error=86400")
      .header("etag", etag)
      .type("application/json; charset=utf-8")
      .send(publication.catalog);
  });

  server.get("/v1/revocations", async (request, reply) => {
    const serialized = JSON.stringify(publication.revocations);
    const etag = `"sha256-${createHash("sha256").update(serialized).digest("base64url")}"`;
    if (request.headers["if-none-match"] === etag) return reply.code(304).send();
    return reply
      .header("cache-control", "public, max-age=60, stale-if-error=3600")
      .header("etag", etag)
      .type("application/json; charset=utf-8")
      .send(publication.revocations);
  });

  server.get("/v1/extensions/:id/:version/download", async (request, reply) => {
    const parameters = PackageParamsSchema.parse(request.params);
    const extensionPackage = gallery.package(parameters.id, parameters.version);
    if (!extensionPackage) return reply.code(404).send({ error: "Extension package not found" });
    const { entry } = extensionPackage;
    const digest = Buffer.from(entry.packageSha256, "hex").toString("base64");
    return reply
      .header("cache-control", "public, max-age=31536000, immutable")
      .header("etag", `"sha256-${entry.packageSha256}"`)
      .header("digest", `sha-256=:${digest}:`)
      .header("content-disposition", `attachment; filename="${entry.id}-${entry.version}.locusx"`)
      .header("content-length", entry.packageSize)
      .type("application/vnd.locus.extension+zip")
      .send(createReadStream(extensionPackage.path));
  });

  return server;
}
