import {
  trustedGalleryFingerprints,
  verifySignedExtensionCatalog,
  verifySignedExtensionRevocations,
} from "@locus/extensions";

const origin = serviceOrigin(process.env.LOCUS_EXTENSION_GALLERY_URL);
const health = await request("/health");
const healthBody = await health.json();
if (!health.ok || healthBody.ok !== true || healthBody.catalog !== "ready" || healthBody.revocations !== "ready" || healthBody.storage !== "ready") {
  throw new Error("Extension gallery health check did not report every dependency ready");
}
const catalogResponse = await request("/v1/extensions");
const revocationsResponse = await request("/v1/revocations");
const catalog = JSON.parse(await boundedText(catalogResponse, 512 * 1024));
const revocations = JSON.parse(await boundedText(revocationsResponse, 2 * 1024 * 1024));
const verifiedCatalog = verifySignedExtensionCatalog(catalog, trustedGalleryFingerprints);
verifySignedExtensionRevocations(revocations, trustedGalleryFingerprints);
if (healthBody.extensions !== verifiedCatalog.extensions.length) throw new Error("Health extension count does not match the signed catalog");

for (const extension of verifiedCatalog.extensions) {
  const response = await request(extension.downloadPath, { method: "HEAD" });
  if (response.headers.get("content-length") !== String(extension.packageSize)) throw new Error(`Package size mismatch for ${extension.id}`);
  if (response.headers.get("etag") !== `"sha256-${extension.packageSha256}"`) throw new Error(`Package ETag mismatch for ${extension.id}`);
  if (response.headers.get("content-type") !== "application/vnd.locus.extension+zip") throw new Error(`Package type mismatch for ${extension.id}`);
}

process.stdout.write(`Verified production extension gallery at ${origin} with ${verifiedCatalog.extensions.length} published extensions.\n`);

async function request(path, init = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`${origin}${path}`, { ...init, redirect: "manual", signal: controller.signal });
    if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
    if (response.url && new URL(response.url).origin !== origin) throw new Error(`${path} changed origin`);
    if (response.headers.get("x-content-type-options") !== "nosniff") throw new Error(`${path} is missing hardened headers`);
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

async function boundedText(response, limit) {
  const declared = Number(response.headers.get("content-length") || 0);
  if (!Number.isInteger(declared) || declared <= 0 || declared > limit) throw new Error("Gallery document has an invalid content length");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength !== declared || bytes.byteLength > limit) throw new Error("Gallery document length changed while downloading");
  return new TextDecoder().decode(bytes);
}

function serviceOrigin(raw) {
  const url = new URL(raw ?? "");
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) {
    throw new Error("LOCUS_EXTENSION_GALLERY_URL must be a credential-free HTTPS origin");
  }
  return url.origin;
}
