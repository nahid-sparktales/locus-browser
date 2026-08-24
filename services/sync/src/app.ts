import Fastify, { type FastifyInstance } from "fastify";
import {
  createSyncRequestHandler,
  hashToken,
  type SyncRequestHandlerOptions,
} from "./requestHandler.js";
import type { SyncRepository } from "./types.js";

export type SyncAppOptions = SyncRequestHandlerOptions;
export { hashToken };

export function createSyncApp(repository: SyncRepository, options: SyncAppOptions = {}): FastifyInstance {
  const server = Fastify({ logger: false, bodyLimit: 3 * 1024 * 1024, trustProxy: false });
  const handler = createSyncRequestHandler(options);

  server.route({
    method: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    url: "/*",
    async handler(request, reply) {
      const headers = new Headers();
      for (const [name, value] of Object.entries(request.headers)) {
        if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
        else if (value !== undefined) headers.set(name, value);
      }
      const method = request.method.toUpperCase();
      const hasBody = !["GET", "HEAD"].includes(method) && request.body !== undefined;
      const response = await handler.fetch(new Request(`http://${request.headers.host ?? "localhost"}${request.raw.url ?? request.url}`, {
        method,
        headers,
        ...(hasBody ? { body: serializeBody(request.body, headers) } : {}),
      }), repository);
      reply.code(response.status);
      response.headers.forEach((value, name) => reply.header(name, value));
      return reply.send(Buffer.from(await response.arrayBuffer()));
    },
  });

  return server;
}

function serializeBody(body: unknown, headers: Headers): BodyInit {
  if (typeof body === "string") return body;
  if (body instanceof Uint8Array) return Uint8Array.from(body).buffer;
  if (!headers.has("content-type")) headers.set("content-type", "application/json");
  return JSON.stringify(body);
}
