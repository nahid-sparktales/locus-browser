import { createHash } from "node:crypto";
import { mkdir, mkdtemp, open, realpath, rm, type FileHandle } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  ExtensionGalleryCatalogSchema,
  extensionGalleryDownloadPath,
  type ExtensionGalleryCatalog,
  type ExtensionGalleryEntry,
} from "@locus/extensions";

const MAX_CATALOG_BYTES = 1024 * 1024;
const MAX_PACKAGE_BYTES = 50 * 1024 * 1024;
const CATALOG_TIMEOUT_MS = 8_000;
const PACKAGE_TIMEOUT_MS = 60_000;
const PACKAGE_CONTENT_TYPES = new Set([
  "application/vnd.locus.extension+zip",
  "application/octet-stream",
]);

export interface DownloadedGalleryPackage {
  entry: ExtensionGalleryEntry;
  path: string;
  dispose(): Promise<void>;
}

export class ExtensionGalleryClient {
  readonly #serviceUrl: string;
  readonly #downloadRoot: string;
  #catalog: ExtensionGalleryCatalog | undefined;
  #etag: string | undefined;

  constructor(serviceUrl: string, downloadRoot: string) {
    this.#serviceUrl = normalizeGalleryServiceUrl(serviceUrl);
    this.#downloadRoot = resolve(downloadRoot);
  }

  get serviceUrl(): string {
    return this.#serviceUrl;
  }

  catalog(): ExtensionGalleryCatalog | undefined {
    return this.#catalog;
  }

  async refresh(): Promise<ExtensionGalleryCatalog> {
    const response = await fetch(`${this.#serviceUrl}/v1/extensions`, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS),
      headers: {
        accept: "application/json",
        ...(this.#etag ? { "if-none-match": this.#etag } : {}),
      },
    });
    if (response.status === 304 && this.#catalog) return this.#catalog;
    if (!response.ok) throw new Error(`Extension gallery returned ${response.status}`);
    const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (contentType !== "application/json") throw new Error("Extension gallery returned an unexpected content type");
    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (declaredLength > MAX_CATALOG_BYTES) throw new Error("Extension gallery catalog exceeds 1 MB");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_CATALOG_BYTES) throw new Error("Extension gallery catalog exceeds 1 MB");
    const catalog = ExtensionGalleryCatalogSchema.parse(JSON.parse(Buffer.from(bytes).toString("utf8")));
    for (const entry of catalog.extensions) this.#validatedDownloadUrl(entry);
    this.#catalog = catalog;
    this.#etag = response.headers.get("etag") ?? undefined;
    return catalog;
  }

  async download(extensionId: string): Promise<DownloadedGalleryPackage> {
    const entry = this.#catalog?.extensions.find((candidate) => candidate.id === extensionId);
    if (!entry) throw new Error("Refresh the extension gallery before installing this package");
    const url = this.#validatedDownloadUrl(entry);
    const response = await fetch(url, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(PACKAGE_TIMEOUT_MS),
      headers: {
        accept: "application/vnd.locus.extension+zip, application/octet-stream",
        "accept-encoding": "identity",
      },
    });
    if (!response.ok) throw new Error(`Extension package download returned ${response.status}`);
    const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (!contentType || !PACKAGE_CONTENT_TYPES.has(contentType)) {
      throw new Error("Extension package download returned an unexpected content type");
    }
    const contentEncoding = response.headers.get("content-encoding")?.trim().toLowerCase();
    if (contentEncoding && contentEncoding !== "identity") {
      throw new Error("Extension package download must not transform signed bytes");
    }
    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (declaredLength > MAX_PACKAGE_BYTES || (declaredLength && declaredLength !== entry.packageSize)) {
      throw new Error("Extension package download size does not match the gallery catalog");
    }
    if (!response.body) throw new Error("Extension package download returned no content");

    await mkdir(this.#downloadRoot, { recursive: true, mode: 0o700 });
    const canonicalRoot = await realpath(this.#downloadRoot);
    const temporaryDirectory = await mkdtemp(join(canonicalRoot, ".package-"));
    const packagePath = join(temporaryDirectory, `${entry.id}-${entry.version}.locusx`);
    const handle = await open(packagePath, "wx", 0o600);
    const hash = createHash("sha256");
    let receivedBytes = 0;
    try {
      for await (const chunk of response.body) {
        const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
        receivedBytes += bytes.byteLength;
        if (receivedBytes > MAX_PACKAGE_BYTES || receivedBytes > entry.packageSize) {
          throw new Error("Extension package download exceeded its catalog size");
        }
        hash.update(bytes);
        await writeAll(handle, bytes);
      }
      await handle.sync();
      if (receivedBytes !== entry.packageSize || hash.digest("hex") !== entry.packageSha256) {
        throw new Error("Extension package download failed its SHA-256 integrity check");
      }
    } catch (error) {
      await handle.close();
      await rm(temporaryDirectory, { recursive: true, force: true });
      throw error;
    }
    await handle.close();
    return {
      entry,
      path: packagePath,
      dispose: async () => rm(temporaryDirectory, { recursive: true, force: true }),
    };
  }

  #validatedDownloadUrl(entry: ExtensionGalleryEntry): string {
    if (entry.downloadPath !== extensionGalleryDownloadPath(entry.id, entry.version)) {
      throw new Error("Extension gallery returned an unexpected package path");
    }
    const url = new URL(entry.downloadPath, this.#serviceUrl);
    if (url.origin !== new URL(this.#serviceUrl).origin || url.username || url.password || url.search || url.hash) {
      throw new Error("Extension gallery package must stay on the configured gallery origin");
    }
    return url.toString();
  }
}

async function writeAll(handle: FileHandle, bytes: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const { bytesWritten } = await handle.write(bytes, offset, bytes.byteLength - offset);
    if (!bytesWritten) throw new Error("Extension package download could not be written");
    offset += bytesWritten;
  }
}

export function normalizeGalleryServiceUrl(value: string): string {
  const url = new URL(value);
  const localHttp = url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !localHttp) throw new Error("Extension gallery must use HTTPS except on localhost");
  if (url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) {
    throw new Error("Extension gallery URL must be an origin without credentials, query, or path");
  }
  return url.origin;
}
