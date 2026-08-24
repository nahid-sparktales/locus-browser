import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";
import { createReadStream, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const releaseRoot = join(root, "release");
const requireSignature = process.argv.includes("--require-signature");
const packageJson = JSON.parse(readFileSync(join(root, "apps/desktop/package.json"), "utf8"));
const candidates = readdirSync(releaseRoot, { withFileTypes: true })
  .filter((entry) => entry.isFile() && releaseArtifact(entry.name))
  .map((entry) => join(releaseRoot, entry.name))
  .sort((left, right) => left.localeCompare(right));
const files = [];
for (const path of candidates) {
  files.push({
    name: basename(path),
    size: statSync(path).size,
    sha256: await fileSha256(path),
  });
}
if (!files.length) throw new Error("No release artifacts were found");

const manifest = {
  contractVersion: 1,
  channel: "canary",
  version: packageJson.version,
  generatedAt: new Date().toISOString(),
  gitRevision: process.env.GITHUB_SHA || gitRevision(),
  artifacts: files,
};
const canonical = Buffer.from(`${JSON.stringify(manifest)}\n`);
const encodedKey = process.env.LOCUS_RELEASE_SIGNING_PRIVATE_KEY || "";
let signature;
if (encodedKey) {
  const privateKey = createPrivateKey(Buffer.from(encodedKey, "base64").toString("utf8"));
  const publicKey = createPublicKey(privateKey);
  signature = {
    algorithm: "Ed25519",
    publicKey: publicKey.export({ format: "pem", type: "spki" }).toString(),
    fingerprint: createHash("sha256").update(publicKey.export({ format: "der", type: "spki" })).digest("hex"),
    value: sign(null, canonical, privateKey).toString("base64"),
  };
} else if (requireSignature) {
  throw new Error("LOCUS_RELEASE_SIGNING_PRIVATE_KEY is required for a public canary");
}
mkdirSync(releaseRoot, { recursive: true });
writeFileSync(join(releaseRoot, "release-manifest.json"), `${JSON.stringify({ manifest, ...(signature ? { signature } : {}) }, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`Wrote release manifest for ${files.length} artifacts${signature ? " with an Ed25519 signature" : " (unsigned development output)"}.\n`);

function gitRevision() {
  return process.env.LOCUS_GIT_REVISION || "development";
}

function fileSha256(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function releaseArtifact(name) {
  return /\.(?:dmg|zip|blockmap)$/i.test(name)
    || name === "canary-mac.yml"
    || name === "sbom.cdx.json";
}
