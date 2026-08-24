import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import {
  trustedGalleryFingerprints,
  verifyLocusx,
  verifySignedExtensionCatalog,
  verifySignedExtensionRevocations,
} from "@locus/extensions";

const packageDirectory = resolve(required("LOCUS_GALLERY_PACKAGES"));
const metadataDirectory = resolve(required("LOCUS_GALLERY_METADATA"));
const bucket = process.env.LOCUS_GALLERY_BUCKET || "locus-browser-extension-gallery-production";
const catalogPath = join(metadataDirectory, "catalog.json");
const revocationsPath = join(metadataDirectory, "revocations.json");
const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
const revocations = JSON.parse(readFileSync(revocationsPath, "utf8"));
const verifiedCatalog = verifySignedExtensionCatalog(catalog, trustedGalleryFingerprints);
verifySignedExtensionRevocations(revocations, trustedGalleryFingerprints);

const packages = new Map();
for (const name of readdirSync(packageDirectory).filter((entry) => entry.toLowerCase().endsWith(".locusx")).sort()) {
  const path = join(packageDirectory, name);
  const metadata = lstatSync(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`Gallery package must be a regular file: ${name}`);
  const archive = readFileSync(path);
  const verified = verifyLocusx(archive, trustedGalleryFingerprints);
  const key = `${verified.id}\0${verified.manifest.version}`;
  if (packages.has(key)) throw new Error(`Duplicate package: ${verified.id} ${verified.manifest.version}`);
  packages.set(key, {
    path,
    id: verified.id,
    version: verified.manifest.version,
    size: archive.byteLength,
    sha256: createHash("sha256").update(archive).digest("hex"),
    publisherFingerprint: verified.publisherFingerprint,
    galleryFingerprint: verified.galleryFingerprint,
  });
}

for (const entry of verifiedCatalog.extensions) {
  const extensionPackage = packages.get(`${entry.id}\0${entry.version}`);
  if (!extensionPackage || extensionPackage.size !== entry.packageSize || extensionPackage.sha256 !== entry.packageSha256
    || extensionPackage.publisherFingerprint !== entry.publisherFingerprint || extensionPackage.galleryFingerprint !== entry.galleryFingerprint) {
    throw new Error(`Signed catalog does not match ${entry.id} ${entry.version}`);
  }
}

const wrangler = join(process.cwd(), "node_modules", ".bin", "wrangler");
for (const extensionPackage of packages.values()) {
  upload(
    `packages/${extensionPackage.id}/${extensionPackage.version}/${extensionPackage.id}-${extensionPackage.version}.locusx`,
    extensionPackage.path,
    "application/vnd.locus.extension+zip",
    "public, max-age=31536000, immutable",
    `attachment; filename="${basename(extensionPackage.path)}"`,
  );
}
upload("metadata/revocations.json", revocationsPath, "application/json; charset=utf-8", "public, max-age=60, stale-if-error=3600");
upload("metadata/catalog.json", catalogPath, "application/json; charset=utf-8", "public, max-age=300, stale-if-error=86400");
process.stdout.write(`Uploaded signed gallery publication with ${verifiedCatalog.extensions.length} discoverable extensions to ${bucket}.\n`);

function upload(key, path, contentType, cacheControl, contentDisposition) {
  const args = ["r2", "object", "put", `${bucket}/${key}`, "--file", path, "--content-type", contentType, "--cache-control", cacheControl, "--remote", "--force"];
  if (contentDisposition) args.push("--content-disposition", contentDisposition);
  execFileSync(wrangler, args, { stdio: "inherit" });
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
