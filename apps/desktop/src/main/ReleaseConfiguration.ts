import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

const ReleaseConfigurationSchema = z.object({
  contractVersion: z.literal(1),
  galleryUrl: z.string().max(2_048).optional(),
  syncUrl: z.string().max(2_048).optional(),
}).strict();

export interface ReleaseConfiguration {
  galleryUrl?: string;
  syncUrl?: string;
}

export function loadReleaseConfiguration(options: {
  packaged: boolean;
  resourcesPath: string;
  environment?: NodeJS.ProcessEnv;
}): ReleaseConfiguration {
  if (options.packaged) {
    try {
      const parsed = ReleaseConfigurationSchema.parse(JSON.parse(
        readFileSync(join(options.resourcesPath, "release-config.json"), "utf8"),
      ));
      return {
        ...(parsed.galleryUrl ? { galleryUrl: serviceOrigin(parsed.galleryUrl, true) } : {}),
        ...(parsed.syncUrl ? { syncUrl: serviceOrigin(parsed.syncUrl, true) } : {}),
      };
    } catch {
      return {};
    }
  }

  const environment = options.environment ?? process.env;
  return {
    ...(environment.LOCUS_EXTENSION_GALLERY_URL
      ? { galleryUrl: serviceOrigin(environment.LOCUS_EXTENSION_GALLERY_URL, false) }
      : { galleryUrl: "http://127.0.0.1:8790" }),
    ...(environment.LOCUS_SYNC_URL
      ? { syncUrl: serviceOrigin(environment.LOCUS_SYNC_URL, false) }
      : { syncUrl: "http://127.0.0.1:8787" }),
  };
}

function serviceOrigin(raw: string, production: boolean): string {
  const url = new URL(raw);
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if ((production || !loopback) && url.protocol !== "https:") throw new Error("Service URLs require HTTPS");
  if (url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) {
    throw new Error("Service URLs must be credential-free origins");
  }
  return url.origin;
}
