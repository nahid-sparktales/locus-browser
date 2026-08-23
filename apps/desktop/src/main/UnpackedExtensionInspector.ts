import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath, stat } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import {
  extensionLocalResources,
  validateExtensionFile,
  validateManifest,
  type LocusExtensionManifest,
} from "@locus/extensions";

export const MAX_UNPACKED_EXTENSION_FILES = 5_000;
export const MAX_UNPACKED_EXTENSION_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_UNPACKED_EXTENSION_BYTES = 50 * 1024 * 1024;
const MAX_UNPACKED_EXTENSION_DEPTH = 16;

export interface UnpackedExtensionInspection {
  path: string;
  manifest: LocusExtensionManifest;
  fingerprint: string;
  fileCount: number;
  totalBytes: number;
}

export async function inspectUnpackedExtension(requestedPath: string): Promise<UnpackedExtensionInspection> {
  const root = await realpath(resolve(requestedPath));
  if (!(await stat(root)).isDirectory()) throw new Error("Choose an unpacked extension folder");
  const files: Array<{ path: string; bytes: Uint8Array }> = [];
  let totalBytes = 0;

  const visit = async (directory: string, depth: number): Promise<void> => {
    if (depth > MAX_UNPACKED_EXTENSION_DEPTH) throw new Error("Extension folder nesting is too deep");
    const children = await readdir(directory, { withFileTypes: true });
    children.sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }));
    for (const child of children) {
      const childPath = resolve(directory, child.name);
      const metadata = await lstat(childPath);
      if (metadata.isSymbolicLink()) throw new Error(`Linked extension files are forbidden: ${portableRelative(root, childPath)}`);
      if (metadata.isDirectory()) {
        await visit(childPath, depth + 1);
        continue;
      }
      if (!metadata.isFile()) continue;
      if (files.length >= MAX_UNPACKED_EXTENSION_FILES) throw new Error("Extension contains too many files");
      if (metadata.size > MAX_UNPACKED_EXTENSION_FILE_BYTES) throw new Error(`Extension file exceeds 25 MB: ${portableRelative(root, childPath)}`);
      totalBytes += metadata.size;
      if (totalBytes > MAX_UNPACKED_EXTENSION_BYTES) throw new Error("Extension folder exceeds 50 MB");
      const path = portableRelative(root, childPath);
      const bytes = await readFile(childPath);
      validateExtensionFile(path, bytes);
      files.push({ path, bytes });
    }
  };

  await visit(root, 0);
  const manifestFile = files.find((file) => file.path === "manifest.json");
  if (!manifestFile) throw new Error("Extension is missing manifest.json");
  let rawManifest: unknown;
  try {
    rawManifest = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(manifestFile.bytes));
  } catch {
    throw new Error("Extension manifest is not valid UTF-8 JSON");
  }
  const manifest = validateManifest(rawManifest);
  const availablePaths = new Set(files.map((file) => file.path));
  for (const path of extensionLocalResources(manifest)) {
    if (!availablePaths.has(path)) throw new Error(`Extension resource is missing: ${path}`);
  }
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file.path).update("\0").update(createHash("sha256").update(file.bytes).digest()).update("\0");
  }
  return { path: root, manifest, fingerprint: hash.digest("hex"), fileCount: files.length, totalBytes };
}

function portableRelative(root: string, target: string): string {
  return relative(root, target).split(sep).join("/");
}
