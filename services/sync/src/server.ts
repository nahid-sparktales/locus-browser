import { randomBytes } from "node:crypto";
import { createSyncApp, hashToken } from "./app.js";
import { MemorySyncRepository } from "./memoryRepository.js";
import { PostgresSyncRepository } from "./postgresRepository.js";

const repository = process.env.DATABASE_URL
  ? new PostgresSyncRepository(process.env.DATABASE_URL)
  : new MemorySyncRepository();
const bootstrapToken = process.env.LOCUS_SYNC_BOOTSTRAP_TOKEN || randomBytes(32).toString("base64url");
const bootstrapDevice = {
  accountId: process.env.LOCUS_SYNC_BOOTSTRAP_ACCOUNT || "development-account",
  deviceId: process.env.LOCUS_SYNC_BOOTSTRAP_DEVICE || "development-device",
};
if (repository instanceof MemorySyncRepository) repository.enrollToken(hashToken(bootstrapToken), bootstrapDevice);
else if (process.env.LOCUS_SYNC_BOOTSTRAP_TOKEN) await repository.bootstrap(hashToken(bootstrapToken), bootstrapDevice);

const server = createSyncApp(repository);
await server.listen({ host: process.env.HOST || "127.0.0.1", port: Number(process.env.PORT || 8787) });
if (!process.env.LOCUS_SYNC_BOOTSTRAP_TOKEN) server.log.warn("A temporary development device token was generated");
