import { createHash, createPublicKey, verify } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const release = process.argv.includes("--release");
const checks = [];
const packageJson = JSON.parse(readFileSync(join(root, "apps/desktop/package.json"), "utf8"));
const platformRoot = process.env.LOCUS_PLATFORM_ROOT || join(root, "..", "locus-platform");
const codexComponentPath = join(platformRoot, "agent/ollama_code/runtime_components/codex-app-server.json");
let codexComponent;
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
  "scripts/create-update-metadata.mjs",
  "scripts/create-release-manifest.mjs",
  "scripts/publish-release.mjs",
  ".github/workflows/ci.yml",
  ".github/workflows/canary-release.yml",
  "SECURITY.md",
  "docs/canary-runbook.md",
  "docs/sync-deployment.md",
  "services/sync-worker/wrangler.jsonc",
  "services/gallery-worker/wrangler.jsonc",
  "supabase/migrations/20260824001215_create_locus_sync_private_schema.sql",
  "supabase/tests/locus_sync_permissions.sql",
]) check(path, () => { if (!existsSync(join(root, path))) throw new Error("missing"); });
check("Cloudflare sync deployment contract", () => {
  const config = JSON.parse(readFileSync(join(root, "services/sync-worker/wrangler.jsonc"), "utf8"));
  if (config.compatibility_date !== "2026-08-23" || !config.compatibility_flags?.includes("nodejs_compat")) {
    throw new Error("unexpected Worker runtime contract");
  }
  if (config.hyperdrive?.[0]?.binding !== "SYNC_DATABASE" || config.r2_buckets?.[0]?.binding !== "SYNC_OBJECTS") {
    throw new Error("sync storage bindings are missing");
  }
  if (config.ratelimits?.length !== 2 || new Set(config.ratelimits.map((item) => item.namespace_id)).size !== 2) {
    throw new Error("sync rate-limit namespaces are missing or shared");
  }
});
check("Cloudflare extension gallery deployment contract", () => {
  const config = JSON.parse(readFileSync(join(root, "services/gallery-worker/wrangler.jsonc"), "utf8"));
  const fingerprint = "d1257f8fe1c98e28efeb83b9fa1755cca4e82aa0360391bb73a7b054b161f10d";
  if (config.compatibility_date !== "2026-08-24" || config.workers_dev !== false) {
    throw new Error("unexpected gallery Worker runtime contract");
  }
  if (config.routes?.[0]?.pattern !== "extensions.locushost.co" || config.routes[0].custom_domain !== true) {
    throw new Error("production gallery custom domain is missing");
  }
  if (config.r2_buckets?.[0]?.binding !== "GALLERY_OBJECTS"
    || config.r2_buckets[0].bucket_name !== "locus-browser-extension-gallery-production") {
    throw new Error("private production gallery storage is missing");
  }
  if (config.ratelimits?.[0]?.name !== "PUBLIC_RATE_LIMITER"
    || config.ratelimits[0].simple?.limit !== 120 || config.ratelimits[0].simple?.period !== 60) {
    throw new Error("gallery rate limit binding is missing");
  }
  if (config.vars?.LOCUS_GALLERY_FINGERPRINT !== fingerprint) {
    throw new Error("gallery Worker signing identity is not pinned");
  }
  const trustStore = readFileSync(join(root, "packages/extensions/src/index.ts"), "utf8");
  if (!trustStore.includes(fingerprint)) throw new Error("desktop gallery trust store differs from the Worker");
});
check("Pinned managed ChatGPT component contract", () => {
  codexComponent = JSON.parse(readFileSync(codexComponentPath, "utf8"));
  const target = codexComponent.targets?.["darwin-arm64"];
  if (codexComponent.schema_version !== 1 || !/^\d+\.\d+\.\d+$/.test(codexComponent.version ?? "")) {
    throw new Error("invalid component manifest");
  }
  if (target?.package !== "@openai/codex" || target.package_version !== `${codexComponent.version}-darwin-arm64`) {
    throw new Error("unexpected component package");
  }
  for (const field of ["archive_sha256", "executable_sha256"]) {
    if (!/^[0-9a-f]{64}$/.test(target[field] ?? "")) throw new Error(`${field} is not pinned`);
  }
});
check("Pinned Electron compatibility evidence", () => {
  const registry = JSON.parse(readFileSync(join(root, "packages/extensions/registry.json"), "utf8"));
  const electron = packageJson.devDependencies?.electron;
  if (registry.canaryEngine?.electron !== electron) throw new Error("registry and desktop Electron versions differ");
});
check("Pinned platform canary contract", () => {
  const workflow = readFileSync(join(root, ".github/workflows/ci.yml"), "utf8");
  if (!workflow.includes("ref: v0.1.0-canary.4")) throw new Error("browser CI is not pinned to the reviewed platform tag");
});
check("Discoverable canary update contract", () => {
  const workflow = readFileSync(join(root, ".github/workflows/canary-release.yml"), "utf8");
  const updater = readFileSync(join(root, "apps/desktop/src/main/AppUpdater.ts"), "utf8");
  const desktopPackage = readFileSync(join(root, "apps/desktop/package.json"), "utf8");
  if (!workflow.includes('tags: ["v*-canary.*"]')) throw new Error("release tags are not SemVer-compatible");
  if (!updater.includes('autoUpdater.channel = "canary"')) throw new Error("desktop updater is not on the canary channel");
  if (!desktopPackage.includes("create-update-metadata.mjs")) throw new Error("canary metadata generation is missing");
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
    if (process.env.GITHUB_REF_NAME && process.env.GITHUB_REF_NAME !== `v${packageJson.version}`) {
      throw new Error(`expected v${packageJson.version}`);
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
    for (const suffix of [".dmg", ".zip", "canary-mac.yml"]) {
      if (!names.some((name) => name.endsWith(suffix))) throw new Error(`missing ${suffix}`);
    }
    const expectedZip = `Locus-Browser-${packageJson.version}-arm64.zip`;
    const metadata = readFileSync(join(root, "release/canary-mac.yml"), "utf8");
    if (!metadata.includes(`version: "${packageJson.version}"`) || !metadata.includes(`url: "${expectedZip}"`)) {
      throw new Error("canary update metadata does not match the packaged version");
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
    if (!sbom.components.some((component) => component.name === "OpenAI Codex App Server" && component.version === codexComponent.version)) {
      throw new Error("managed ChatGPT component is missing from the SBOM");
    }
  });
  check("Bundled managed ChatGPT runtime", () => {
    const componentRoot = join(root, "release/mac-arm64/Locus Browser.app/Contents/Resources/AgentRuntime/components/codex-app-server");
    const packagedManifest = join(componentRoot, "component.json");
    const executable = join(componentRoot, "codex");
    if (sha256(packagedManifest) !== sha256(codexComponentPath)) throw new Error("packaged component contract differs from the platform release");
    const reported = execFileSync(executable, ["--version"], { encoding: "utf8", timeout: 15_000 }).trim();
    if (reported !== `codex-cli ${codexComponent.version}`) throw new Error(`unexpected helper version ${reported || "unknown"}`);
    const file = execFileSync("/usr/bin/file", [executable], { encoding: "utf8" });
    if (!file.includes("Mach-O 64-bit executable arm64")) throw new Error("helper is not Apple Silicon");
    execFileSync("/usr/bin/codesign", ["--verify", "--strict", "--verbose=2", executable], { stdio: "pipe" });
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
    if (![...names].some((name) => name.endsWith(".dmg")) || ![...names].some((name) => name.endsWith(".zip"))
      || !names.has("canary-mac.yml") || !names.has("sbom.cdx.json")) {
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

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
