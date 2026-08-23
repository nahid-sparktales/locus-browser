import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import {
  verifyLocusx,
  type LocusExtensionManifest,
  type VerifiedLocusExtension,
} from "@locus/extensions";

const MAX_PACKAGE_BYTES = 50 * 1024 * 1024;
const PACKAGE_METADATA_FILES = new Set(["inventory.json", "signatures.json"]);

export interface SignedExtensionInspection {
  path: string;
  fingerprint: string;
  id: string;
  manifest: LocusExtensionManifest;
  publisherFingerprint: string;
  galleryFingerprint: string;
  fileCount: number;
  totalBytes: number;
}

export interface InstalledGalleryPackage extends SignedExtensionInspection {
  installPath: string;
}

export class GalleryExtensionStore {
  readonly #root: string;
  readonly #trustedGalleryFingerprints: ReadonlySet<string>;

  constructor(root: string, trustedGalleryFingerprints: ReadonlySet<string>) {
    this.#root = resolve(root);
    this.#trustedGalleryFingerprints = trustedGalleryFingerprints;
  }

  get trustedKeyCount(): number {
    return this.#trustedGalleryFingerprints.size;
  }

  async inspect(requestedPath: string): Promise<SignedExtensionInspection> {
    const requestedMetadata = await lstat(resolve(requestedPath));
    if (requestedMetadata.isSymbolicLink()) throw new Error("Linked extension packages are forbidden");
    const archivePath = await realpath(resolve(requestedPath));
    const metadata = await stat(archivePath);
    if (!metadata.isFile()) throw new Error("Choose a signed .locusx extension package");
    if (!archivePath.toLowerCase().endsWith(".locusx")) throw new Error("Signed extension packages must use the .locusx file extension");
    if (metadata.size > MAX_PACKAGE_BYTES) throw new Error("Extension package exceeds 50 MB");
    const archive = await readFile(archivePath);
    const verified = verifyLocusx(archive, this.#trustedGalleryFingerprints);
    return inspectionFromVerified(archivePath, archive, verified);
  }

  async install(reviewed: SignedExtensionInspection): Promise<InstalledGalleryPackage> {
    const inspection = await this.inspect(reviewed.path);
    if (
      inspection.fingerprint !== reviewed.fingerprint
      || inspection.id !== reviewed.id
      || inspection.manifest.version !== reviewed.manifest.version
    ) {
      throw new Error("Signed extension package changed while permissions were being reviewed");
    }
    const archive = await readFile(inspection.path);
    const verified = verifyLocusx(archive, this.#trustedGalleryFingerprints);
    const root = await this.#canonicalRoot();
    const destination = join(
      root,
      verified.id,
      `${verified.manifest.version}-${inspection.fingerprint.slice(0, 16)}`,
    );
    try {
      const existing = await lstat(destination);
      if (existing.isSymbolicLink() || !existing.isDirectory()) {
        throw new Error("Managed extension copy is not a directory");
      }
      await assertInstalledFilesMatch(destination, verified);
      return { ...inspection, installPath: destination };
    } catch (error) {
      if (!isMissing(error)) throw error;
    }

    const staging = await mkdtemp(join(root, ".install-"));
    try {
      for (const [path, bytes] of verified.files) {
        if (PACKAGE_METADATA_FILES.has(path)) continue;
        const target = join(staging, ...path.split("/"));
        assertInside(staging, target);
        await mkdir(dirname(target), { recursive: true, mode: 0o700 });
        await writeFile(target, bytes, { flag: "wx", mode: 0o600 });
      }
      await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
      await rename(staging, destination);
      return { ...inspection, installPath: destination };
    } catch (error) {
      await rm(staging, { recursive: true, force: true });
      try {
        const existing = await lstat(destination);
        if (existing.isDirectory() && !existing.isSymbolicLink()) {
          await assertInstalledFilesMatch(destination, verified);
          return { ...inspection, installPath: destination };
        }
      } catch (destinationError) {
        if (!isMissing(destinationError)) throw destinationError;
      }
      throw error;
    }
  }

  async removeManagedVersion(path: string): Promise<void> {
    const root = await this.#canonicalRoot();
    const requested = resolve(path);
    assertInside(root, requested);
    let metadata;
    try {
      metadata = await lstat(requested);
    } catch (error) {
      if (isMissing(error)) return;
      throw error;
    }
    if (metadata.isSymbolicLink()) {
      await rm(requested, { force: true });
      return;
    }
    const target = await realpath(requested);
    assertInside(root, target);
    await rm(target, { recursive: true, force: true });
  }

  async #canonicalRoot(): Promise<string> {
    await mkdir(this.#root, { recursive: true, mode: 0o700 });
    return realpath(this.#root);
  }
}

async function assertInstalledFilesMatch(root: string, verified: VerifiedLocusExtension): Promise<void> {
  const expected = new Map(
    [...verified.files.entries()].filter(([path]) => !PACKAGE_METADATA_FILES.has(path)),
  );
  const expectedDirectories = new Set<string>();
  for (const path of expected.keys()) {
    const parts = path.split("/");
    for (let index = 1; index < parts.length; index += 1) {
      expectedDirectories.add(parts.slice(0, index).join("/"));
    }
  }

  const visit = async (directory: string, prefix = ""): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      const target = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error("Managed extension copy contains a linked file");
      if (entry.isDirectory()) {
        if (!expectedDirectories.has(path)) throw new Error("Managed extension copy contains an unexpected directory");
        await visit(target, path);
        continue;
      }
      if (!entry.isFile()) throw new Error("Managed extension copy contains a special file");
      const expectedBytes = expected.get(path);
      if (!expectedBytes) throw new Error("Managed extension copy contains an unexpected file");
      const actualBytes = await readFile(target);
      if (
        actualBytes.byteLength !== expectedBytes.byteLength
        || createHash("sha256").update(actualBytes).digest("hex")
          !== createHash("sha256").update(expectedBytes).digest("hex")
      ) {
        throw new Error("Managed extension copy failed its integrity check");
      }
      expected.delete(path);
    }
  };

  await visit(root);
  if (expected.size) throw new Error("Managed extension copy is incomplete");
}

function inspectionFromVerified(
  archivePath: string,
  archive: Uint8Array,
  verified: VerifiedLocusExtension,
): SignedExtensionInspection {
  const extensionFiles = [...verified.files.entries()].filter(([path]) => !PACKAGE_METADATA_FILES.has(path));
  return {
    path: archivePath,
    fingerprint: createHash("sha256").update(archive).digest("hex"),
    id: verified.id,
    manifest: verified.manifest,
    publisherFingerprint: verified.publisherFingerprint,
    galleryFingerprint: verified.galleryFingerprint,
    fileCount: extensionFiles.length,
    totalBytes: extensionFiles.reduce((total, [, bytes]) => total + bytes.byteLength, 0),
  };
}

function assertInside(root: string, target: string): void {
  const path = relative(resolve(root), resolve(target));
  if (!path || path === ".." || path.startsWith(`..${sep}`) || resolve(path) === path) {
    throw new Error("Extension package path escaped managed storage");
  }
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
