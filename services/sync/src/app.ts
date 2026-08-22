import { createHash, randomBytes, randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { z } from "zod";
import type { AuthenticatedDevice, OpaqueSyncRecord, SyncRepository } from "./types.js";

const CollectionSchema = z.enum(["bookmarks", "history", "tab-groups", "remote-tabs", "settings", "extensions"]);
const RecordSchema = z.object({
  accountId: z.string().min(1).max(128),
  deviceId: z.string().min(1).max(128),
  collection: CollectionSchema,
  recordId: z.string().min(1).max(512),
  clock: z.string().regex(/^\d{13}-\d{6}-[A-Za-z0-9_-]+$/),
  nonce: z.string().min(16).max(128),
  ciphertext: z.string().min(1).max(2_800_000),
  tombstone: z.boolean().default(false),
});
const PushSchema = z.object({ records: z.array(RecordSchema).max(500) });

declare module "fastify" {
  interface FastifyRequest { device?: AuthenticatedDevice }
}

export function createSyncApp(repository: SyncRepository): FastifyInstance {
  const server = Fastify({ logger: false, bodyLimit: 3 * 1024 * 1024, trustProxy: false });

  server.get("/health", async () => ({ ok: true }));

  server.addHook("preHandler", async (request, reply) => {
    if (request.url === "/health" || request.url.startsWith("/v1/devices/enrollments/claim")) return;
    const token = bearerToken(request);
    if (!token) return reply.code(401).send({ error: "Device authentication required" });
    const device = await repository.authenticate(hashToken(token));
    if (!device) return reply.code(401).send({ error: "Unknown or revoked device" });
    request.device = device;
  });

  server.post("/v1/sync/push", async (request, reply) => {
    const body = PushSchema.parse(request.body);
    const device = request.device!;
    const records: OpaqueSyncRecord[] = body.records.map((record) => ({
      ...record,
      size: Buffer.byteLength(record.ciphertext, "base64url"),
    }));
    if (records.some((record) => record.size > 2 * 1024 * 1024)) return reply.code(413).send({ error: "A record exceeds 2 MB" });
    const cursor = await repository.push(device, records);
    return { accepted: records.length, cursor };
  });

  server.get("/v1/sync/pull", async (request) => {
    const query = z.object({ cursor: z.coerce.number().int().nonnegative().default(0), limit: z.coerce.number().int().min(1).max(500).default(200) }).parse(request.query);
    return await repository.pull(request.device!.accountId, query.cursor, query.limit);
  });

  server.post("/v1/devices/enrollments", async (request) => {
    const body = z.object({ deviceId: z.string().min(1).max(128), publicKey: z.string().min(32).max(512) }).parse(request.body);
    const id = randomUUID();
    const code = randomBytes(18).toString("base64url");
    await repository.createEnrollment({
      id,
      accountId: request.device!.accountId,
      deviceId: body.deviceId,
      publicKey: body.publicKey,
      codeHash: hashToken(code),
      expiresAt: Date.now() + 10 * 60_000,
    });
    return { enrollmentId: id, approvalCode: code, expiresInSeconds: 600 };
  });

  server.post("/v1/devices/enrollments/:id/approve", async (request) => {
    const parameters = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({ wrappedAccountKey: z.string().min(32).max(1_024) }).parse(request.body);
    const deviceToken = randomBytes(32).toString("base64url");
    await repository.approveEnrollment(request.device!.accountId, parameters.id, body.wrappedAccountKey, deviceToken, hashToken(deviceToken));
    return { approved: true };
  });

  server.post("/v1/devices/enrollments/claim", async (request, reply) => {
    const body = z.object({ enrollmentId: z.string().uuid(), approvalCode: z.string().min(20).max(128) }).parse(request.body);
    const delivery = await repository.takeEnrollment(body.enrollmentId, hashToken(body.approvalCode));
    if (!delivery) return reply.code(404).send({ error: "Enrollment is not approved or has expired" });
    return delivery;
  });

  server.delete("/v1/devices/:id", async (request) => {
    const parameters = z.object({ id: z.string().min(1).max(128) }).parse(request.params);
    await repository.revokeDevice(request.device!.accountId, parameters.id);
    return { revoked: true };
  });

  server.delete("/v1/sync/cloud-data", async (request) => {
    await repository.deleteCloudData(request.device!.accountId);
    return { deleted: true };
  });

  server.delete("/v1/account", async (request) => {
    await repository.deleteAccount(request.device!.accountId);
    return { deleted: true };
  });

  server.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError) return reply.code(400).send({ error: "Invalid request", issues: error.issues });
    return reply.code(400).send({ error: error instanceof Error ? error.message : "Request failed" });
  });

  return server;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function bearerToken(request: FastifyRequest): string {
  const match = /^Bearer ([A-Za-z0-9_-]{20,})$/.exec(request.headers.authorization ?? "");
  return match?.[1] ?? "";
}
