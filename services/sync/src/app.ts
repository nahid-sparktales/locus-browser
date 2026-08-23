import { createHash, randomBytes, randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { z } from "zod";
import {
  passkeyCeremonyHtml,
  passkeyClientCss,
  passkeyClientScript,
  simpleWebAuthnToolkit,
  type PasskeyConfig,
  type PasskeyToolkit,
} from "./passkeyAuth.js";
import type { AuthenticatedDevice, OpaqueSyncRecord, SyncRepository } from "./types.js";

const CollectionSchema = z.enum(["bookmarks", "history", "tab-groups", "remote-tabs", "settings", "extensions"]);
const RecordSchema = z.object({
  version: z.literal(1).default(1),
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
const DeviceIdentitySchema = z.object({
  deviceId: z.string().min(8).max(128),
  devicePublicKey: z.string().min(32).max(512),
});
const PasskeyResponseSchema = z.object({
  id: z.string().min(1).max(2_048),
  rawId: z.string().min(1).max(2_048),
  type: z.literal("public-key"),
  response: z.record(z.string(), z.unknown()),
  clientExtensionResults: z.record(z.string(), z.unknown()).default({}),
  authenticatorAttachment: z.string().optional(),
});

export interface SyncAppOptions {
  passkeyConfig?: PasskeyConfig;
  passkeyToolkit?: PasskeyToolkit;
}

const PasskeyConfigSchema = z.object({
  rpName: z.string().trim().min(1).max(80),
  rpId: z.string().regex(/^(localhost|(?:[A-Za-z0-9-]+\.)*[A-Za-z0-9-]+)$/),
  origin: z.string().url().refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname));
  }, "Passkey origin must use HTTPS except on localhost"),
  callbackScheme: z.string().regex(/^[a-z][a-z0-9+.-]*$/),
});

declare module "fastify" {
  interface FastifyRequest { device?: AuthenticatedDevice }
}

export function createSyncApp(repository: SyncRepository, options: SyncAppOptions = {}): FastifyInstance {
  const server = Fastify({ logger: false, bodyLimit: 3 * 1024 * 1024, trustProxy: false });
  const passkeyConfig = PasskeyConfigSchema.parse(options.passkeyConfig ?? {
    rpName: "Locus Sync",
    rpId: "localhost",
    origin: "http://localhost:8787",
    callbackScheme: "locus-browser",
  });
  const passkeys = options.passkeyToolkit ?? simpleWebAuthnToolkit;

  server.get("/health", async () => ({ ok: true }));

  server.addHook("preHandler", async (request, reply) => {
    if (request.url === "/health"
      || request.url.startsWith("/v1/devices/enrollments/claim")
      || request.url.startsWith("/v1/auth/passkeys/")) return;
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
    const result = await repository.push(device, records);
    await repository.cleanupExpired(Date.now());
    return result;
  });

  server.get("/v1/sync/pull", async (request) => {
    const query = z.object({ cursor: z.coerce.number().int().nonnegative().default(0), limit: z.coerce.number().int().min(1).max(500).default(200) }).parse(request.query);
    return await repository.pull(request.device!.accountId, query.cursor, query.limit);
  });

  server.post("/v1/auth/passkeys/register/options", async (request) => {
    await repository.cleanupExpired(Date.now());
    const body = DeviceIdentitySchema.extend({ displayName: z.string().trim().min(1).max(80) }).parse(request.body);
    const accountId = randomUUID();
    const userId = randomBytes(32).toString("base64url");
    const registrationOptions = await passkeys.registrationOptions({
      config: passkeyConfig,
      userId,
      displayName: body.displayName,
    });
    const ceremonyId = randomUUID();
    await repository.createPasskeyCeremony({
      id: ceremonyId,
      kind: "register",
      accountId,
      userId,
      displayName: body.displayName,
      challenge: registrationOptions.challenge,
      optionsJson: JSON.stringify(registrationOptions),
      deviceId: body.deviceId,
      devicePublicKey: body.devicePublicKey,
      expiresAt: Date.now() + 5 * 60_000,
    });
    return { ceremonyId, authUrl: `${passkeyConfig.origin}/v1/auth/passkeys/ceremonies/${ceremonyId}` };
  });

  server.post("/v1/auth/passkeys/authenticate/options", async (request) => {
    await repository.cleanupExpired(Date.now());
    const body = DeviceIdentitySchema.parse(request.body);
    const authenticationOptions = await passkeys.authenticationOptions({ config: passkeyConfig });
    const ceremonyId = randomUUID();
    await repository.createPasskeyCeremony({
      id: ceremonyId,
      kind: "authenticate",
      challenge: authenticationOptions.challenge,
      optionsJson: JSON.stringify(authenticationOptions),
      deviceId: body.deviceId,
      devicePublicKey: body.devicePublicKey,
      expiresAt: Date.now() + 5 * 60_000,
    });
    return { ceremonyId, authUrl: `${passkeyConfig.origin}/v1/auth/passkeys/ceremonies/${ceremonyId}` };
  });

  server.get("/v1/auth/passkeys/ceremonies/:id", async (request, reply) => {
    const parameters = z.object({ id: z.string().uuid() }).parse(request.params);
    if (!await repository.passkeyCeremony(parameters.id)) return reply.code(404).type("text/plain").send("Passkey request unavailable");
    return reply
      .header("content-security-policy", "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
      .header("x-frame-options", "DENY")
      .header("referrer-policy", "no-referrer")
      .header("cache-control", "no-store")
      .type("text/html; charset=utf-8")
      .send(passkeyCeremonyHtml());
  });

  server.get("/v1/auth/passkeys/client.js", async (_request, reply) => reply
    .header("cache-control", "public, max-age=300")
    .type("application/javascript; charset=utf-8")
    .send(passkeyClientScript()));

  server.get("/v1/auth/passkeys/client.css", async (_request, reply) => reply
    .header("cache-control", "public, max-age=300")
    .type("text/css; charset=utf-8")
    .send(passkeyClientCss()));

  server.get("/v1/auth/passkeys/ceremonies/:id/options", async (request, reply) => {
    const parameters = z.object({ id: z.string().uuid() }).parse(request.params);
    const ceremony = await repository.passkeyCeremony(parameters.id);
    if (!ceremony) return reply.code(404).send({ error: "Passkey request unavailable" });
    return reply.header("cache-control", "no-store").send({ kind: ceremony.kind, options: JSON.parse(ceremony.optionsJson) });
  });

  server.post("/v1/auth/passkeys/ceremonies/:id/verify", async (request, reply) => {
    const parameters = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({ credential: PasskeyResponseSchema }).parse(request.body);
    const pending = await repository.passkeyCeremony(parameters.id);
    if (!pending) return reply.code(404).send({ error: "Passkey request unavailable" });
    const ceremony = await repository.consumePasskeyCeremony(parameters.id, pending.kind);
    if (!ceremony) return reply.code(409).send({ error: "Passkey request was already used" });

    const deviceToken = randomBytes(32).toString("base64url");
    let accountId: string;
    if (ceremony.kind === "register") {
      if (!ceremony.accountId || !ceremony.userId) throw new Error("Passkey registration is incomplete");
      const verification = await passkeys.verifyRegistration({
        config: passkeyConfig,
        challenge: ceremony.challenge,
        response: body.credential,
      });
      if (!verification.verified || !verification.credential) return reply.code(400).send({ error: "Passkey verification failed" });
      accountId = ceremony.accountId;
      await repository.createAccountWithPasskey(accountId, {
        credentialId: verification.credential.id,
        accountId,
        userId: ceremony.userId,
        publicKey: verification.credential.publicKey,
        counter: verification.credential.counter,
        deviceType: verification.credential.deviceType,
        backedUp: verification.credential.backedUp,
        transports: verification.credential.transports,
      }, {
        accountId,
        deviceId: ceremony.deviceId,
        publicKey: ceremony.devicePublicKey,
        tokenHash: hashToken(deviceToken),
      });
    } else {
      const passkey = await repository.passkey(body.credential.id);
      if (!passkey) return reply.code(400).send({ error: "Passkey is unavailable" });
      const verification = await passkeys.verifyAuthentication({
        config: passkeyConfig,
        challenge: ceremony.challenge,
        response: body.credential,
        passkey,
      });
      if (!verification.verified || verification.newCounter === undefined) return reply.code(400).send({ error: "Passkey verification failed" });
      accountId = passkey.accountId;
      await repository.authenticateWithPasskey(passkey.credentialId, verification.newCounter, {
        accountId,
        deviceId: ceremony.deviceId,
        publicKey: ceremony.devicePublicKey,
        tokenHash: hashToken(deviceToken),
      });
    }

    const claimId = randomUUID();
    const claimCode = randomBytes(32).toString("base64url");
    await repository.createPasskeyClaim({
      id: claimId,
      codeHash: hashToken(claimCode),
      accountId,
      deviceId: ceremony.deviceId,
      deviceToken,
      expiresAt: Date.now() + 2 * 60_000,
    });
    const callbackUrl = `${passkeyConfig.callbackScheme}://sync-auth/callback?claimId=${encodeURIComponent(claimId)}&claimCode=${encodeURIComponent(claimCode)}`;
    return reply.header("cache-control", "no-store").send({ callbackUrl });
  });

  server.post("/v1/auth/passkeys/claims", async (request, reply) => {
    const body = z.object({ claimId: z.string().uuid(), claimCode: z.string().min(32).max(128) }).parse(request.body);
    const claim = await repository.takePasskeyClaim(body.claimId, hashToken(body.claimCode));
    if (!claim) return reply.code(404).send({ error: "Passkey claim is unavailable" });
    return reply.header("cache-control", "no-store").send(claim);
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
