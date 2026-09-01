import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  passkeyCeremonyHtml,
  passkeyClientCss,
  passkeyClientScript,
  simpleWebAuthnToolkit,
  type PasskeyConfig,
  type PasskeyToolkit,
} from "./passkeyAuth.js";
import {
  AccountKeyWrapSchema,
  DeviceIdentitySchema,
  EnrollmentClaimSchema,
  MAX_RECORD_BYTES,
  PasskeyConfigSchema,
  PasskeyResponseSchema,
  PushSchema,
  RecordSchema,
  safeRequestErrors,
} from "./requestContract.js";
import {
  bearerToken,
  hashToken,
  isPublicRoute,
  json,
  requestBody,
  RequestSizeError,
  RequestValidationError,
  requiredDevice,
  route,
  syncRecords,
  text,
} from "./requestSupport.js";
import type { AuthenticatedDevice, SyncRepository } from "./types.js";

export { hashToken } from "./requestSupport.js";

export interface SyncRequestHandlerOptions {
  passkeyConfig?: PasskeyConfig;
  passkeyToolkit?: PasskeyToolkit;
}

export type SyncRepositoryProvider = SyncRepository | (() => Promise<SyncRepository>);

export interface SyncRequestHandler {
  fetch(request: Request, repository: SyncRepositoryProvider): Promise<Response>;
}

export function createSyncRequestHandler(options: SyncRequestHandlerOptions = {}): SyncRequestHandler {
  const passkeyConfig = PasskeyConfigSchema.parse(options.passkeyConfig ?? {
    rpName: "Locus Sync",
    rpId: "localhost",
    origin: "http://localhost:8787",
    callbackScheme: "locus-browser",
  });
  const passkeys = options.passkeyToolkit ?? simpleWebAuthnToolkit;

  return {
    async fetch(request, repositoryProvider) {
      try {
        const url = new URL(request.url);
        const path = url.pathname;
        const method = request.method.toUpperCase();

        if (method === "GET" && path === "/health") return json({ ok: true });
        if (method === "GET" && path === "/v1/auth/passkeys/client.js") {
          return text(passkeyClientScript(), 200, {
            "cache-control": "public, max-age=300",
            "content-type": "application/javascript; charset=utf-8",
          });
        }
        if (method === "GET" && path === "/v1/auth/passkeys/client.css") {
          return text(passkeyClientCss(), 200, {
            "cache-control": "public, max-age=300",
            "content-type": "text/css; charset=utf-8",
          });
        }

        const repository = typeof repositoryProvider === "function" ? await repositoryProvider() : repositoryProvider;
        let device: AuthenticatedDevice | undefined;
        if (!isPublicRoute(method, path)) {
          const token = bearerToken(request.headers.get("authorization"));
          if (!token) return json({ error: "Device authentication required" }, 401);
          device = await repository.authenticate(hashToken(token));
          if (!device) return json({ error: "Unknown or revoked device" }, 401);
        }

        if (method === "POST" && path === "/v1/sync/push") {
          const body = PushSchema.parse(await requestBody(request));
          const records = syncRecords(body.records);
          if (records.some((record) => record.size > MAX_RECORD_BYTES)) return json({ error: "A record exceeds 2 MB" }, 413);
          const result = await repository.push(requiredDevice(device), body.keyVersion, records);
          await repository.cleanupExpired(Date.now());
          return json(result);
        }

        if (method === "GET" && path === "/v1/sync/pull") {
          const query = z.object({
            cursor: z.coerce.number().int().nonnegative().default(0),
            limit: z.coerce.number().int().min(1).max(500).default(200),
          }).parse(Object.fromEntries(url.searchParams));
          return json(await repository.pull(requiredDevice(device).accountId, query.cursor, query.limit));
        }

        if (method === "POST" && path === "/v1/auth/passkeys/register/options") {
          await repository.cleanupExpired(Date.now());
          const body = DeviceIdentitySchema.extend({ displayName: z.string().trim().min(1).max(80) }).parse(await requestBody(request));
          const accountId = randomUUID();
          const userId = randomBytes(32).toString("base64url");
          const registrationOptions = await passkeys.registrationOptions({ config: passkeyConfig, userId, displayName: body.displayName });
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
            deviceName: body.deviceName,
            devicePublicKey: body.devicePublicKey,
            expiresAt: Date.now() + 5 * 60_000,
          });
          return json({ ceremonyId, authUrl: `${passkeyConfig.origin}/v1/auth/passkeys/ceremonies/${ceremonyId}` });
        }

        if (method === "POST" && path === "/v1/auth/passkeys/authenticate/options") {
          await repository.cleanupExpired(Date.now());
          const body = DeviceIdentitySchema.parse(await requestBody(request));
          const authenticationOptions = await passkeys.authenticationOptions({ config: passkeyConfig });
          const ceremonyId = randomUUID();
          await repository.createPasskeyCeremony({
            id: ceremonyId,
            kind: "authenticate",
            challenge: authenticationOptions.challenge,
            optionsJson: JSON.stringify(authenticationOptions),
            deviceId: body.deviceId,
            deviceName: body.deviceName,
            devicePublicKey: body.devicePublicKey,
            expiresAt: Date.now() + 5 * 60_000,
          });
          return json({ ceremonyId, authUrl: `${passkeyConfig.origin}/v1/auth/passkeys/ceremonies/${ceremonyId}` });
        }

        const ceremonyPage = route(path, /^\/v1\/auth\/passkeys\/ceremonies\/([^/]+)$/);
        if (method === "GET" && ceremonyPage) {
          const parameters = z.object({ id: z.string().uuid() }).parse({ id: ceremonyPage[1] });
          if (!await repository.passkeyCeremony(parameters.id)) return text("Passkey request unavailable", 404);
          return text(passkeyCeremonyHtml(), 200, {
            "cache-control": "no-store",
            "content-security-policy": "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
            "content-type": "text/html; charset=utf-8",
            "referrer-policy": "no-referrer",
            "x-frame-options": "DENY",
          });
        }

        const ceremonyOptions = route(path, /^\/v1\/auth\/passkeys\/ceremonies\/([^/]+)\/options$/);
        if (method === "GET" && ceremonyOptions) {
          const parameters = z.object({ id: z.string().uuid() }).parse({ id: ceremonyOptions[1] });
          const ceremony = await repository.passkeyCeremony(parameters.id);
          if (!ceremony) return json({ error: "Passkey request unavailable" }, 404);
          return json({ kind: ceremony.kind, options: JSON.parse(ceremony.optionsJson) }, 200, { "cache-control": "no-store" });
        }

        const ceremonyVerification = route(path, /^\/v1\/auth\/passkeys\/ceremonies\/([^/]+)\/verify$/);
        if (method === "POST" && ceremonyVerification) {
          const parameters = z.object({ id: z.string().uuid() }).parse({ id: ceremonyVerification[1] });
          const body = z.object({ credential: PasskeyResponseSchema }).parse(await requestBody(request));
          const pending = await repository.passkeyCeremony(parameters.id);
          if (!pending) return json({ error: "Passkey request unavailable" }, 404);
          const ceremony = await repository.consumePasskeyCeremony(parameters.id, pending.kind);
          if (!ceremony) return json({ error: "Passkey request was already used" }, 409);

          const deviceToken = randomBytes(32).toString("base64url");
          let accountId: string;
          if (ceremony.kind === "register") {
            if (!ceremony.accountId || !ceremony.userId) throw new Error("Passkey registration is incomplete");
            const verification = await passkeys.verifyRegistration({ config: passkeyConfig, challenge: ceremony.challenge, response: body.credential });
            if (!verification.verified || !verification.credential) return json({ error: "Passkey verification failed" }, 400);
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
              name: ceremony.deviceName,
              publicKey: ceremony.devicePublicKey,
              tokenHash: hashToken(deviceToken),
              keyVersion: 0,
              createdAt: Date.now(),
              lastSeenAt: Date.now(),
            });
          } else {
            const passkey = await repository.passkey(body.credential.id);
            if (!passkey) return json({ error: "Passkey is unavailable" }, 400);
            const verification = await passkeys.verifyAuthentication({
              config: passkeyConfig,
              challenge: ceremony.challenge,
              response: body.credential,
              passkey,
            });
            if (!verification.verified || verification.newCounter === undefined) return json({ error: "Passkey verification failed" }, 400);
            accountId = passkey.accountId;
            await repository.authenticateWithPasskey(passkey.credentialId, verification.newCounter, {
              accountId,
              deviceId: ceremony.deviceId,
              name: ceremony.deviceName,
              publicKey: ceremony.devicePublicKey,
              tokenHash: hashToken(deviceToken),
              keyVersion: 0,
              createdAt: Date.now(),
              lastSeenAt: Date.now(),
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
          return json({ callbackUrl }, 200, { "cache-control": "no-store" });
        }

        if (method === "POST" && path === "/v1/auth/passkeys/claims") {
          const body = z.object({ claimId: z.string().uuid(), claimCode: z.string().min(32).max(128) }).parse(await requestBody(request));
          const claim = await repository.takePasskeyClaim(body.claimId, hashToken(body.claimCode));
          if (!claim) return json({ error: "Passkey claim is unavailable" }, 404);
          return json(claim, 200, { "cache-control": "no-store" });
        }

        if (method === "POST" && path === "/v1/devices/enrollments") {
          await repository.cleanupExpired(Date.now());
          const body = z.object({
            deviceId: z.string().min(8).max(128),
            deviceName: z.string().trim().min(1).max(80),
            publicKey: z.string().min(32).max(512),
          }).parse(await requestBody(request));
          const id = randomUUID();
          const code = randomBytes(18).toString("base64url");
          await repository.createEnrollment({
            id,
            deviceId: body.deviceId,
            deviceName: body.deviceName,
            publicKey: body.publicKey,
            codeHash: hashToken(code),
            expiresAt: Date.now() + 10 * 60_000,
          });
          return json({ enrollmentId: id, approvalCode: code, expiresInSeconds: 600 });
        }

        const enrollmentDetails = route(path, /^\/v1\/devices\/enrollments\/([^/]+)\/details$/);
        if (method === "POST" && enrollmentDetails) {
          const parameters = z.object({ id: z.string().uuid() }).parse({ id: enrollmentDetails[1] });
          const body = z.object({ approvalCode: z.string().min(20).max(128) }).parse(await requestBody(request));
          const details = await repository.enrollmentDetails(parameters.id, hashToken(body.approvalCode));
          return details ? json(details) : json({ error: "Enrollment is unavailable" }, 404);
        }

        const enrollmentApproval = route(path, /^\/v1\/devices\/enrollments\/([^/]+)\/approve$/);
        if (method === "POST" && enrollmentApproval) {
          const parameters = z.object({ id: z.string().uuid() }).parse({ id: enrollmentApproval[1] });
          const body = z.object({
            approvalCode: z.string().min(20).max(128),
            wrappedAccountKey: z.string().min(32).max(1_024),
          }).parse(await requestBody(request));
          const deviceToken = randomBytes(32).toString("base64url");
          await repository.approveEnrollment(
            requiredDevice(device).accountId,
            parameters.id,
            hashToken(body.approvalCode),
            body.wrappedAccountKey,
            deviceToken,
            hashToken(deviceToken),
          );
          return json({ approved: true });
        }

        if (method === "POST" && path === "/v1/devices/enrollments/claim") {
          const body = EnrollmentClaimSchema.parse(await requestBody(request));
          const delivery = await repository.takeEnrollment(body.enrollmentId, hashToken(body.approvalCode));
          if (!delivery) return json({ error: "Enrollment is not approved or has expired" }, 404);
          return json(delivery);
        }

        if (method === "GET" && path === "/v1/devices") {
          const current = requiredDevice(device);
          return json({ devices: (await repository.listDevices(current.accountId)).map((item) => ({ ...item, current: item.deviceId === current.deviceId })) });
        }

        if (method === "GET" && path === "/v1/account/key") {
          const current = requiredDevice(device);
          return json(await repository.accountKeyState(current.accountId, current.deviceId));
        }

        if (method === "PUT" && path === "/v1/account/key") {
          const body = z.object({
            expectedVersion: z.literal(0),
            version: z.literal(1),
            wraps: z.array(AccountKeyWrapSchema).min(1).max(100),
          }).parse(await requestBody(request));
          await repository.initializeAccountKey(requiredDevice(device).accountId, body.expectedVersion, body.version, body.wraps);
          return json({ version: body.version });
        }

        if (method === "PUT" && path === "/v1/devices/self/key") {
          const body = z.object({
            version: z.number().int().positive(),
            wrappedAccountKey: z.string().min(32).max(1_024),
          }).parse(await requestBody(request));
          const current = requiredDevice(device);
          await repository.setDeviceWrappedKey(current.accountId, current.deviceId, body.version, body.wrappedAccountKey);
          return json({ version: body.version });
        }

        if (method === "POST" && path === "/v1/account/key/rotate") {
          const body = z.object({
            expectedVersion: z.number().int().positive(),
            version: z.number().int().min(2),
            wraps: z.array(AccountKeyWrapSchema).min(1).max(100),
            records: z.array(RecordSchema).min(1).max(500),
          }).parse(await requestBody(request));
          const records = syncRecords(body.records);
          if (records.some((record) => record.size > MAX_RECORD_BYTES)) return json({ error: "A record exceeds 2 MB" }, 413);
          return json(await repository.rotateAccountKey(requiredDevice(device), body.expectedVersion, body.version, body.wraps, records));
        }

        if (method === "DELETE" && path === "/v1/devices/self") {
          const current = requiredDevice(device);
          await repository.revokeDevice(current.accountId, current.deviceId);
          return json({ revoked: true });
        }

        const deviceRevocation = route(path, /^\/v1\/devices\/([^/]+)$/);
        if (method === "DELETE" && deviceRevocation) {
          const parameters = z.object({ id: z.string().min(1).max(128) }).parse({ id: decodeURIComponent(deviceRevocation[1]!) });
          const current = requiredDevice(device);
          if (parameters.id === current.deviceId) return json({ error: "Disconnect this device from Locus Browser instead" }, 400);
          await repository.revokeDevice(current.accountId, parameters.id);
          return json({ revoked: true });
        }

        if (method === "DELETE" && path === "/v1/sync/cloud-data") {
          await repository.deleteCloudData(requiredDevice(device).accountId);
          return json({ deleted: true });
        }

        if (method === "DELETE" && path === "/v1/account") {
          await repository.deleteAccount(requiredDevice(device).accountId);
          return json({ deleted: true });
        }

        return json({ error: "Not found" }, 404);
      } catch (error) {
        if (error instanceof RequestSizeError) return json({ error: error.message }, 413);
        if (error instanceof RequestValidationError) return json({ error: error.message }, 400);
        if (error instanceof z.ZodError) return json({ error: "Invalid request", issues: error.issues }, 400);
        if (error instanceof Error && safeRequestErrors.has(error.message)) return json({ error: error.message }, 400);
        return json({ error: "Request failed" }, 500);
      }
    },
  };
}
