import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

export async function createUpdateMetadata({
  releaseRoot,
  version,
  releaseDate = new Date().toISOString(),
}) {
  if (!/^\d+\.\d+\.\d+-canary\.\d+$/.test(version)) {
    throw new Error(`Cannot create canary metadata for version ${version}`);
  }
  const zipName = `Locus-Browser-${version}-arm64.zip`;
  const zipPath = join(releaseRoot, zipName);
  if (!existsSync(zipPath)) throw new Error(`Update archive ${zipName} is missing`);

  const sha512 = await fileDigest(zipPath, "sha512", "base64");
  const size = statSync(zipPath).size;
  const metadata = [
    `version: ${yamlString(version)}`,
    "files:",
    `  - url: ${yamlString(zipName)}`,
    `    sha512: ${yamlString(sha512)}`,
    `    size: ${size}`,
    `path: ${yamlString(zipName)}`,
    `sha512: ${yamlString(sha512)}`,
    `releaseDate: ${yamlString(releaseDate)}`,
    "",
  ].join("\n");
  const output = join(releaseRoot, "canary-mac.yml");
  writeFileSync(output, metadata, { mode: 0o644 });
  return { output, zipName, sha512, size };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const packageJson = JSON.parse(readFileSync(join(root, "apps/desktop/package.json"), "utf8"));
  const result = await createUpdateMetadata({
    releaseRoot: join(root, "release"),
    version: packageJson.version,
  });
  process.stdout.write(`Wrote ${basename(result.output)} for ${result.zipName}.\n`);
}

function yamlString(value) {
  return JSON.stringify(value);
}

function fileDigest(path, algorithm, encoding) {
  return new Promise((resolve, reject) => {
    const hash = createHash(algorithm);
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest(encoding)));
  });
}
