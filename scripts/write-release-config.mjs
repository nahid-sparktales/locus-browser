import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const required = process.argv.includes("--require-production");
const galleryUrl = validate("LOCUS_EXTENSION_GALLERY_URL", process.env.LOCUS_EXTENSION_GALLERY_URL);
const syncUrl = validate("LOCUS_SYNC_URL", process.env.LOCUS_SYNC_URL);
if (required && (!galleryUrl || !syncUrl)) {
  throw new Error("LOCUS_EXTENSION_GALLERY_URL and LOCUS_SYNC_URL are required for a canary package");
}
const destination = join(root, "apps/desktop/dist/release-config.json");
mkdirSync(join(root, "apps/desktop/dist"), { recursive: true });
writeFileSync(destination, `${JSON.stringify({
  contractVersion: 1,
  ...(galleryUrl ? { galleryUrl } : {}),
  ...(syncUrl ? { syncUrl } : {}),
}, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`Wrote sealed release configuration (${galleryUrl ? "gallery" : "gallery disabled"}, ${syncUrl ? "sync" : "sync disabled"}).\n`);

function validate(name, raw) {
  if (!raw?.trim()) return undefined;
  const url = new URL(raw.trim());
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) {
    throw new Error(`${name} must be a credential-free HTTPS origin`);
  }
  return url.origin;
}
