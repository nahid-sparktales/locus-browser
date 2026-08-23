import { createHash } from "node:crypto";
import { mkdir, mkdtemp, open, readFile, realpath, rename, rm, writeFile, type FileHandle } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  extensionIsRevoked,
  extensionGalleryDownloadPath,
  trustedGalleryFingerprints,
  verifySignedExtensionCatalog,
  verifySignedExtensionRevocations,
  type ExtensionGalleryCatalog,
  type ExtensionGalleryEntry,
  type ExtensionRevocation,
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
  readonly #clientId: string;
  readonly #trustedFingerprints: Set<string>;
  readonly #trustDevelopmentDocuments: boolean;
  #catalog: ExtensionGalleryCatalog | undefined;
  #revocations: ExtensionRevocation[] = [];

  constructor(
    serviceUrl: string,
    downloadRoot: string,
    clientId = downloadRoot,
    trustedFingerprints: ReadonlySet<string> = trustedGalleryFingerprints,
    trustDevelopmentDocuments = false,
  ) {
    this.#serviceUrl = normalizeGalleryServiceUrl(serviceUrl);
    this.#downloadRoot = resolve(downloadRoot);
    this.#clientId = clientId;
    this.#trustedFingerprints = new Set(trustedFingerprints);
    this.#trustDevelopmentDocuments = trustDevelopmentDocuments;
  }

  get serviceUrl(): string {
    return this.#serviceUrl;
  }

  catalog(): ExtensionGalleryCatalog | undefined {
    return this.#catalog;
  }

  revocations(): readonly ExtensionRevocation[] {
    return this.#revocations;
  }

  async refresh(): Promise<ExtensionGalleryCatalog> {
    let documents: { catalog: unknown; revocations: unknown };
    try {
      const [catalog, revocations] = await Promise.all([
        this.#fetchJson("/v1/extensions"),
        this.#fetchJson("/v1/revocations"),
      ]);
      documents = { catalog, revocations };
    } catch (networkError) {
      try {
        documents = JSON.parse(await readFile(this.#securityDocumentPath(), "utf8")) as typeof documents;
      } catch {
        throw networkError;
      }
    }
    const catalogRaw = documents.catalog;
    const revocationsRaw = documents.revocations;
    if (this.#trustDevelopmentDocuments) {
      for (const document of [catalogRaw, revocationsRaw]) {
        const fingerprint = documentFingerprint(document);
        if (fingerprint) this.#trustedFingerprints.add(fingerprint);
      }
    }
    const source = verifySignedExtensionCatalog(catalogRaw, this.#trustedFingerprints);
    const revocations = verifySignedExtensionRevocations(revocationsRaw, this.#trustedFingerprints).revocations;
    for (const entry of source.extensions) this.#validatedDownloadUrl(entry);
    this.#revocations = revocations;
    this.#catalog = {
      ...source,
      extensions: source.extensions.filter((entry) => !extensionIsRevoked(entry, revocations)
        && eligibleForRollout(entry, this.#clientId)),
    };
    await this.#cacheSecurityDocuments(documents);
    return this.#catalog;
  }

  async download(extensionId: string): Promise<DownloadedGalleryPackage> {
    const entry = this.#catalog?.extensions.find((candidate) => candidate.id === extensionId);
    if (!entry) throw new Error("Refresh the extension gallery before installing this package");
    if (extensionIsRevoked(entry, this.#revocations)) throw new Error("This extension package has been revoked");
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

  async #fetchJson(path: string): Promise<unknown> {
    const response = await fetch(`${this.#serviceUrl}${path}`, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS),
      headers: { accept: "application/json" },
    });
    if (!response.ok) throw new Error(`Extension gallery returned ${response.status}`);
    const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (contentType !== "application/json") throw new Error("Extension gallery returned an unexpected content type");
    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (declaredLength > MAX_CATALOG_BYTES) throw new Error("Extension gallery document exceeds 1 MB");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_CATALOG_BYTES) throw new Error("Extension gallery document exceeds 1 MB");
    return JSON.parse(Buffer.from(bytes).toString("utf8"));
  }

  #securityDocumentPath(): string {
    return join(this.#downloadRoot, "security-documents.json");
  }

  async #cacheSecurityDocuments(documents: { catalog: unknown; revocations: unknown }): Promise<void> {
    await mkdir(this.#downloadRoot, { recursive: true, mode: 0o700 });
    const destination = this.#securityDocumentPath();
    const temporary = `${destination}.next`;
    await writeFile(temporary, `${JSON.stringify(documents)}\n`, { mode: 0o600 });
    await rename(temporary, destination);
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

function eligibleForRollout(entry: ExtensionGalleryEntry, clientId: string): boolean {
  if (!entry.rollout || entry.rollout.percentage >= 100) return true;
  const cohort = createHash("sha256")
    .update(`${entry.id}\0${entry.rollout.seed}\0${clientId}`)
    .digest()
    .readUInt32BE(0) % 100;
  return cohort < entry.rollout.percentage;
}

function documentFingerprint(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || !("signature" in value)) return undefined;
  const signature = value.signature;
  if (!signature || typeof signature !== "object" || !("fingerprint" in signature)) return undefined;
  return typeof signature.fingerprint === "string" && /^[a-f0-9]{64}$/.test(signature.fingerprint)
    ? signature.fingerprint
    : undefined;
}
