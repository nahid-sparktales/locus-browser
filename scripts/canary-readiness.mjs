import { createPublicKey, verify } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const release = process.argv.includes("--release");
const checks = [];
const packageJson = JSON.parse(readFileSync(join(root, "apps/desktop/package.json"), "utf8"));
check("Desktop canary version", () => {
  const value = packageJson.version;
  if (!/^\d+\.\d+\.\d+-canary\.\d+$/.test(value)) throw new Error(`unexpected version ${value}`);
});
for (const path of [
  "apps/desktop/electron-builder.yml",
  "apps/desktop/build/entitlements.mac.plist",
  "apps/desktop/build/entitlements.mac.inherit.plist",
  "apps/desktop/build/app-update.yml",
  "scripts/prepare-agent-runtime.sh",
  "scripts/create-sbom.mjs",
  "scripts/create-release-manifest.mjs",
  "scripts/publish-release.mjs",
  ".github/workflows/ci.yml",
  ".github/workflows/canary-release.yml",
  "SECURITY.md",
  "docs/canary-runbook.md",
]) check(path, () => { if (!existsSync(join(root, path))) throw new Error("missing"); });
check("Pinned Electron compatibility evidence", () => {
  const registry = JSON.parse(readFileSync(join(root, "packages/extensions/registry.json"), "utf8"));
  const electron = packageJson.devDependencies?.electron;
  if (registry.canaryEngine?.electron !== electron) throw new Error("registry and desktop Electron versions differ");
});
if (release) {
  for (const name of [
    "APPLE_API_KEY", "APPLE_API_KEY_ID", "APPLE_API_ISSUER",
    "LOCUS_RELEASE_SIGNING_PRIVATE_KEY", "LOCUS_EXTENSION_GALLERY_URL", "LOCUS_SYNC_URL", "LOCUS_PLATFORM_REF",
  ]) check(`Release secret ${name}`, () => { if (!process.env[name]) throw new Error("not configured"); });
  check("Immutable platform release", () => {
    if (process.env.LOCUS_PLATFORM_REF === "main") throw new Error("main is not an immutable platform release");
  });
  check("Release tag matches package version", () => {
    if (process.env.GITHUB_REF_NAME && process.env.GITHUB_REF_NAME !== `canary-v${packageJson.version}`) {
      throw new Error(`expected canary-v${packageJson.version}`);
    }
  });
  check("Sealed production service origins", () => {
    const config = JSON.parse(readFileSync(join(root, "release/mac-arm64/Locus Browser.app/Contents/Resources/release-config.json"), "utf8"));
    for (const [field, name] of [["galleryUrl", "LOCUS_EXTENSION_GALLERY_URL"], ["syncUrl", "LOCUS_SYNC_URL"]]) {
      const expected = serviceOrigin(process.env[name]);
      if (config[field] !== expected) throw new Error(`${field} does not match the release environment`);
    }
  });
  check("DMG, ZIP, and update metadata", () => {
    const names = readdirSync(join(root, "release"));
    for (const suffix of [".dmg", ".zip", "latest-mac.yml"]) {
      if (!names.some((name) => name.endsWith(suffix))) throw new Error(`missing ${suffix}`);
    }
  });
  check("CycloneDX software bill of materials", () => {
    const sbom = JSON.parse(readFileSync(join(root, "release/sbom.cdx.json"), "utf8"));
    if (sbom.bomFormat !== "CycloneDX" || !Array.isArray(sbom.components) || !sbom.components.length) {
      throw new Error("invalid or empty SBOM");
    }
    if (!sbom.components.some((component) => component.purl?.startsWith("pkg:pypi/"))) {
      throw new Error("embedded Python dependencies are missing from the SBOM");
    }
  });
  check("Signed release manifest", () => {
    const envelope = JSON.parse(readFileSync(join(root, "release/release-manifest.json"), "utf8"));
    if (envelope.manifest?.version !== packageJson.version || envelope.signature?.algorithm !== "Ed25519") {
      throw new Error("invalid release manifest envelope");
    }
    const key = createPublicKey(envelope.signature.publicKey);
    const valid = verify(null, Buffer.from(`${JSON.stringify(envelope.manifest)}\n`), key, Buffer.from(envelope.signature.value, "base64"));
    if (!valid) throw new Error("release manifest signature is invalid");
    const names = new Set(envelope.manifest.artifacts.map((artifact) => artifact.name));
    if (![...names].some((name) => name.endsWith(".dmg")) || ![...names].some((name) => name.endsWith(".zip")) || !names.has("sbom.cdx.json")) {
      throw new Error("release manifest is incomplete");
    }
  });
}
let failures = 0;
for (const result of checks) {
  const marker = result.error ? "FAIL" : "PASS";
  process.stdout.write(`${marker.padEnd(5)} ${result.name}${result.error ? ` — ${result.error}` : ""}\n`);
  if (result.error) failures += 1;
}
if (failures) process.exitCode = 1;
else process.stdout.write(`Canary source gate passed (${checks.length} checks).\n`);

function check(name, action) {
  try { action(); checks.push({ name }); }
  catch (error) { checks.push({ name, error: error instanceof Error ? error.message : "failed" }); }
}

function serviceOrigin(raw) {
  const url = new URL(raw ?? "");
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) {
    throw new Error("release service URLs must be credential-free HTTPS origins");
  }
  return url.origin;
}
