import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const releaseRoot = join(root, "release");
const tag = process.env.GITHUB_REF_NAME;
const version = JSON.parse(readFileSync(join(root, "apps/desktop/package.json"), "utf8")).version;
if (tag !== `v${version}`) throw new Error(`GITHUB_REF_NAME must be v${version}`);
const files = readdirSync(releaseRoot, { withFileTypes: true })
  .filter((entry) => entry.isFile() && (releaseArtifact(entry.name) || entry.name === "release-manifest.json"))
  .map((entry) => join(releaseRoot, entry.name))
  .sort();
for (const required of [".dmg", ".zip", "canary-mac.yml", "sbom.cdx.json", "release-manifest.json"]) {
  if (!files.some((path) => path.endsWith(required))) throw new Error(`Release artifact ${required} is missing`);
}
const result = spawnSync("gh", [
  "release", "create", tag, ...files,
  "--verify-tag", "--prerelease", "--generate-notes", "--title", `Locus Browser ${tag}`,
], { cwd: root, stdio: "inherit", env: process.env });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

function releaseArtifact(name) {
  return /\.(?:dmg|zip|blockmap)$/i.test(name)
    || name === "canary-mac.yml"
    || name === "sbom.cdx.json";
}
