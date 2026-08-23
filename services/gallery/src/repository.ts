import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import {
  compareExtensionVersions,
  extensionContentScriptMatches,
  ExtensionGalleryCatalogSchema,
  ExtensionGalleryEntrySchema,
  extensionGalleryCatalogVersion,
  extensionGalleryDownloadPath,
  locusxContractVersion,
  trustedGalleryFingerprints,
  verifyLocusx,
  type ExtensionGalleryCatalog,
  type ExtensionGalleryEntry,
} from "@locus/extensions";

const MAX_PACKAGE_BYTES = 50 * 1024 * 1024;

export interface GalleryPackageRecord {
  path: string;
  entry: ExtensionGalleryEntry;
}

export class DirectoryExtensionGallery {
  readonly #root: string;
  readonly #trustedGalleryFingerprints: ReadonlySet<string>;
  #packages = new Map<string, GalleryPackageRecord>();
  #catalog: ExtensionGalleryCatalog = {
    catalogVersion: extensionGalleryCatalogVersion,
    packageContractVersion: locusxContractVersion,
    extensions: [],
  };

  private constructor(root: string, trustedFingerprints: ReadonlySet<string>) {
    this.#root = root;
    this.#trustedGalleryFingerprints = trustedFingerprints;
  }

  static async open(
    requestedRoot: string,
    trustedFingerprints: ReadonlySet<string> = trustedGalleryFingerprints,
  ): Promise<DirectoryExtensionGallery> {
    await mkdir(resolve(requestedRoot), { recursive: true, mode: 0o700 });
    const gallery = new DirectoryExtensionGallery(await realpath(resolve(requestedRoot)), trustedFingerprints);
    await gallery.reload();
    return gallery;
  }

  catalog(): ExtensionGalleryCatalog {
    return this.#catalog;
  }

  package(extensionId: string, version: string): GalleryPackageRecord | undefined {
    return this.#packages.get(packageKey(extensionId, version));
  }

  async reload(): Promise<void> {
    const packages = new Map<string, GalleryPackageRecord>();
    const entries = await readdir(this.#root, { withFileTypes: true });
    for (const directoryEntry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!directoryEntry.name.toLowerCase().endsWith(".locusx")) continue;
      const requestedPath = join(this.#root, directoryEntry.name);
      const metadata = await lstat(requestedPath);
      if (metadata.isSymbolicLink()) throw new Error(`Gallery package cannot be a symbolic link: ${directoryEntry.name}`);
      if (!metadata.isFile()) throw new Error(`Gallery package is not a regular file: ${directoryEntry.name}`);
      if (metadata.size > MAX_PACKAGE_BYTES) throw new Error(`Gallery package exceeds 50 MB: ${directoryEntry.name}`);
      const packagePath = await realpath(requestedPath);
      assertInside(this.#root, packagePath);
      const archive = await readFile(packagePath);
      const verified = verifyLocusx(archive, this.#trustedGalleryFingerprints);
      const key = packageKey(verified.id, verified.manifest.version);
      if (packages.has(key)) throw new Error(`Duplicate gallery package version: ${verified.id} ${verified.manifest.version}`);
      const permissions = [...new Set([
        ...verified.manifest.permissions,
        ...verified.manifest.optional_permissions,
      ])];
      const hostPermissions = [...new Set([
        ...verified.manifest.host_permissions,
        ...verified.manifest.optional_host_permissions,
        ...extensionContentScriptMatches(verified.manifest),
      ])];
      const entry = ExtensionGalleryEntrySchema.parse({
        id: verified.id,
        name: verified.manifest.name,
        version: verified.manifest.version,
        ...(verified.manifest.description ? { description: verified.manifest.description } : {}),
        publisherFingerprint: verified.publisherFingerprint,
        galleryFingerprint: verified.galleryFingerprint,
        packageSha256: createHash("sha256").update(archive).digest("hex"),
        packageSize: archive.byteLength,
        permissions,
        hostPermissions,
        downloadPath: extensionGalleryDownloadPath(verified.id, verified.manifest.version),
      });
      packages.set(key, { path: packagePath, entry });
    }

    const latest = new Map<string, ExtensionGalleryEntry>();
    for (const { entry } of packages.values()) {
      const current = latest.get(entry.id);
      if (!current || compareExtensionVersions(entry.version, current.version) > 0) latest.set(entry.id, entry);
    }
    this.#packages = packages;
    this.#catalog = ExtensionGalleryCatalogSchema.parse({
      catalogVersion: extensionGalleryCatalogVersion,
      packageContractVersion: locusxContractVersion,
      extensions: [...latest.values()].sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id)),
    });
  }
}

function packageKey(extensionId: string, version: string): string {
  return `${extensionId}\0${version}`;
}

function assertInside(root: string, target: string): void {
  const path = relative(root, target);
  if (!path || path === ".." || path.startsWith(`..${sep}`) || resolve(path) === path) {
    throw new Error("Gallery package escaped its configured directory");
  }
}
