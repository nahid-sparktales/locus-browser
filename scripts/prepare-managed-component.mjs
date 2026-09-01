import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  createWriteStream,
  closeSync,
  existsSync,
  openSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

const TARGET = "darwin-arm64";
const REGISTRY_HOST = "registry.npmjs.org";

export function readManagedComponentManifest(path) {
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  return validateManagedComponentManifest(manifest);
}

export function validateManagedComponentManifest(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) fail("manifest must be an object");
  if (manifest.schema_version !== 1) fail("unsupported schema version");
  for (const field of ["id", "name", "version", "license", "documentation_url", "source_url"]) {
    if (typeof manifest[field] !== "string" || !manifest[field]) fail(`${field} is required`);
  }
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) fail("version must be exact");
  const target = manifest.targets?.[TARGET];
  if (!target || typeof target !== "object") fail(`${TARGET} target is required`);
  for (const field of [
    "package", "package_version", "archive_url", "archive_sha256", "executable_path",
    "executable_sha256", "upstream_signing_team_id",
  ]) {
    if (typeof target[field] !== "string" || !target[field]) fail(`${TARGET}.${field} is required`);
  }
  if (target.package !== "@openai/codex") fail("unexpected managed component package");
  if (target.package_version !== `${manifest.version}-darwin-arm64`) fail("package version does not match component version");
  for (const field of ["archive_sha256", "executable_sha256"]) {
    if (!/^[0-9a-f]{64}$/.test(target[field])) fail(`${TARGET}.${field} must be SHA-256`);
  }
  for (const field of ["archive_size", "executable_size"]) {
    if (!Number.isSafeInteger(target[field]) || target[field] <= 0) fail(`${TARGET}.${field} must be a positive integer`);
  }
  const archiveUrl = new URL(target.archive_url);
  if (archiveUrl.protocol !== "https:" || archiveUrl.hostname !== REGISTRY_HOST || archiveUrl.username || archiveUrl.password || archiveUrl.search || archiveUrl.hash) {
    fail(`archive URL must be a credential-free HTTPS URL on ${REGISTRY_HOST}`);
  }
  validateArchivePath(target.executable_path, "executable path");
  const companions = target.companion_executables ?? [];
  if (!Array.isArray(companions)) fail(`${TARGET}.companion_executables must be an array`);
  const names = new Set(["codex"]);
  for (const [index, companion] of companions.entries()) {
    const label = `${TARGET}.companion_executables[${index}]`;
    if (!companion || typeof companion !== "object" || Array.isArray(companion)) fail(`${label} must be an object`);
    if (typeof companion.name !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(companion.name)) {
      fail(`${label}.name must be a safe file name`);
    }
    if (names.has(companion.name)) fail(`${label}.name must be unique`);
    names.add(companion.name);
    if (typeof companion.executable_path !== "string" || !companion.executable_path) fail(`${label}.executable_path is required`);
    validateArchivePath(companion.executable_path, `${label}.executable_path`);
    if (!/^[0-9a-f]{64}$/.test(companion.executable_sha256 ?? "")) fail(`${label}.executable_sha256 must be SHA-256`);
    if (!Number.isSafeInteger(companion.executable_size) || companion.executable_size <= 0) {
      fail(`${label}.executable_size must be a positive integer`);
    }
  }
  return {
    ...manifest,
    target: {
      ...target,
      companion_executables: companions.map((companion) => ({ ...companion })),
    },
  };
}

export function sha256File(path) {
  const hash = createHash("sha256");
  const descriptor = openSync(path, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead = 0;
    do {
      bytesRead = readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead);
  } finally {
    closeSync(descriptor);
  }
  return hash.digest("hex");
}

export function assertPinnedFile(path, expectedSize, expectedSha256, label) {
  const metadata = lstatSync(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`${label} is not a regular file`);
  if (metadata.size !== expectedSize) throw new Error(`${label} size mismatch`);
  if (sha256File(path) !== expectedSha256) throw new Error(`${label} checksum mismatch`);
}

export async function prepareManagedComponent({ manifestPath, cacheRoot, destination, licensePath }) {
  const manifest = readManagedComponentManifest(manifestPath);
  const target = manifest.target;
  const cacheDirectory = join(cacheRoot, manifest.id, manifest.version, target.executable_sha256);
  if (!validCachedComponent(cacheDirectory, manifest)) {
    await downloadAndVerify(manifest, cacheDirectory);
  }

  mkdirSync(destination, { recursive: true, mode: 0o755 });
  for (const executable of managedExecutables(target)) {
    const cachedExecutable = join(cacheDirectory, executable.name);
    assertPinnedFile(cachedExecutable, executable.size, executable.sha256, `cached managed component ${executable.name}`);
    verifyExecutable(cachedExecutable, manifest, false, executable.primary);
    const stagedExecutable = join(destination, executable.name);
    copyFileSync(cachedExecutable, stagedExecutable);
    chmodSync(stagedExecutable, 0o755);
    assertPinnedFile(stagedExecutable, executable.size, executable.sha256, `staged managed component ${executable.name}`);
  }
  copyFileSync(manifestPath, join(destination, "component.json"));
  copyFileSync(licensePath, join(destination, "LICENSE.txt"));
  writeFileSync(join(destination, "NOTICE.md"), managedComponentNotice(manifest), { mode: 0o644 });
  writeFileSync(join(destination, "PROVENANCE"), [
    `component_id=${manifest.id}`,
    `version=${manifest.version}`,
    `target=${TARGET}`,
    `package=${target.package}`,
    `package_version=${target.package_version}`,
    `archive_sha256=${target.archive_sha256}`,
    `executable_sha256=${target.executable_sha256}`,
    ...target.companion_executables.map((companion) => `companion_executable_sha256.${companion.name}=${companion.executable_sha256}`),
    `upstream_signing_team_id=${target.upstream_signing_team_id}`,
    "",
  ].join("\n"), { mode: 0o644 });
  process.stdout.write(`Pinned ${manifest.name} ${manifest.version} staged at ${destination}.\n`);
}

function validCachedComponent(cacheDirectory, manifest) {
  try {
    for (const executable of managedExecutables(manifest.target)) {
      const path = join(cacheDirectory, executable.name);
      if (!existsSync(path)) return false;
      assertPinnedFile(path, executable.size, executable.sha256, `cached managed component ${executable.name}`);
      verifyExecutable(path, manifest, true, executable.primary);
    }
    return true;
  } catch {
    return false;
  }
}

async function downloadAndVerify(manifest, cacheDirectory) {
  const target = manifest.target;
  const executables = managedExecutables(target);
  const workDirectory = mkdtempSync(join(tmpdir(), "locus-managed-component."));
  try {
    const archive = join(workDirectory, "component.tgz");
    const response = await fetch(target.archive_url, { redirect: "error", signal: AbortSignal.timeout(120_000) });
    if (!response.ok || !response.body) throw new Error(`managed component download failed (${response.status})`);
    const contentLength = response.headers.get("content-length");
    if (contentLength !== null && Number(contentLength) !== target.archive_size) throw new Error("managed component download size mismatch");
    let received = 0;
    const limiter = new Transform({
      transform(chunk, _encoding, callback) {
        received += chunk.length;
        if (received > target.archive_size) callback(new Error("managed component download exceeded its pinned size"));
        else callback(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(response.body), limiter, createWriteStream(archive, { mode: 0o600, flags: "wx" }));
    if (received !== target.archive_size) throw new Error("managed component download size mismatch");
    assertPinnedFile(archive, target.archive_size, target.archive_sha256, "managed component archive");

    const extractionRoot = join(workDirectory, "extracted");
    mkdirSync(extractionRoot, { mode: 0o700 });
    execFileSync("/usr/bin/tar", ["-xzf", archive, "-C", extractionRoot, ...executables.map((item) => item.archivePath)], { stdio: "pipe" });
    mkdirSync(cacheDirectory, { recursive: true, mode: 0o755 });
    for (const executable of executables) {
      const extractedExecutable = resolve(extractionRoot, executable.archivePath);
      if (!isContained(extractionRoot, extractedExecutable)) throw new Error("managed component escaped its extraction root");
      assertPinnedFile(extractedExecutable, executable.size, executable.sha256, `managed component executable ${executable.name}`);
      chmodSync(extractedExecutable, 0o755);
      verifyExecutable(extractedExecutable, manifest, true, executable.primary);

      const cachedExecutable = join(cacheDirectory, executable.name);
      const temporaryCachePath = join(cacheDirectory, `.${executable.name}-${process.pid}-${Date.now()}`);
      copyFileSync(extractedExecutable, temporaryCachePath);
      chmodSync(temporaryCachePath, 0o755);
      renameSync(temporaryCachePath, cachedExecutable);
    }
  } finally {
    rmSync(workDirectory, { recursive: true, force: true });
  }
}

function verifyExecutable(path, manifest, verifyUpstreamSignature, verifyVersion) {
  const target = manifest.target;
  const fileDescription = execFileSync("/usr/bin/file", [path], { encoding: "utf8" });
  if (!fileDescription.includes("Mach-O 64-bit executable arm64")) throw new Error("managed component is not an Apple Silicon executable");
  if (verifyVersion) {
    const version = execFileSync(path, ["--version"], { encoding: "utf8", timeout: 15_000 }).trim();
    if (version !== `codex-cli ${manifest.version}`) throw new Error(`managed component version mismatch: ${version || "unknown"}`);
  }
  if (!verifyUpstreamSignature) return;
  execFileSync("/usr/bin/codesign", ["--verify", "--strict", "--verbose=2", path], { stdio: "pipe" });
  const signature = spawnSync("/usr/bin/codesign", ["-dv", "--verbose=4", path], { encoding: "utf8" });
  if (signature.status !== 0) throw new Error("managed component signature could not be inspected");
  const combined = `${signature.stdout ?? ""}\n${signature.stderr ?? ""}`;
  if (!combined.includes(`TeamIdentifier=${target.upstream_signing_team_id}`)) {
    throw new Error("managed component upstream signing identity mismatch");
  }
}

function managedComponentNotice(manifest) {
  return `# ${manifest.name}\n\nLocus Browser bundles ${manifest.name} ${manifest.version} for its optional ChatGPT Plan route.\n\n- Package: ${manifest.target.package}@${manifest.target.package_version}\n- Source: ${manifest.source_url}\n- Documentation: ${manifest.documentation_url}\n- License: ${manifest.license} (see LICENSE.txt)\n`;
}

function managedExecutables(target) {
  return [
    {
      name: "codex",
      archivePath: target.executable_path,
      sha256: target.executable_sha256,
      size: target.executable_size,
      primary: true,
    },
    ...target.companion_executables.map((companion) => ({
      name: companion.name,
      archivePath: companion.executable_path,
      sha256: companion.executable_sha256,
      size: companion.executable_size,
      primary: false,
    })),
  ];
}

function validateArchivePath(path, label) {
  if (path.startsWith("/") || path.split("/").includes("..")) {
    fail(`${label} must remain inside the archive`);
  }
}

function isContained(root, candidate) {
  const relative = candidate.slice(resolve(root).length);
  return candidate === resolve(root) || relative.startsWith(sep);
}

function fail(message) {
  throw new Error(`Invalid managed component manifest: ${message}`);
}

function parseArguments(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (!key?.startsWith("--") || !value) throw new Error("managed component arguments must be --name value pairs");
    result[key.slice(2)] = value;
  }
  for (const key of ["manifest", "cache", "destination", "license"]) {
    if (!result[key]) throw new Error(`--${key} is required`);
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const options = parseArguments(process.argv.slice(2));
  await prepareManagedComponent({
    manifestPath: options.manifest,
    cacheRoot: options.cache,
    destination: options.destination,
    licensePath: options.license,
  });
}
