import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import type { DirectoryExtensionGallery } from "./repository.js";

const PackageParamsSchema = z.object({
  id: z.string().min(1).max(128),
  version: z.string().min(1).max(64),
}).strict();

export function createExtensionGalleryApp(gallery: DirectoryExtensionGallery): FastifyInstance {
  const server = Fastify({ logger: false, bodyLimit: 32 * 1024, trustProxy: false });

  server.addHook("onSend", async (_request, reply, payload) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("referrer-policy", "no-referrer");
    reply.header("content-security-policy", "default-src 'none'; frame-ancestors 'none'; sandbox");
    return payload;
  });

  server.get("/health", async () => ({ ok: true, extensions: gallery.catalog().extensions.length }));

  server.get("/v1/extensions", async (request, reply) => {
    const catalog = gallery.catalog();
    const serialized = JSON.stringify(catalog);
    const etag = `"sha256-${createHash("sha256").update(serialized).digest("base64url")}"`;
    if (request.headers["if-none-match"] === etag) return reply.code(304).send();
    return reply
      .header("cache-control", "public, max-age=300, stale-if-error=86400")
      .header("etag", etag)
      .type("application/json; charset=utf-8")
      .send(catalog);
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
