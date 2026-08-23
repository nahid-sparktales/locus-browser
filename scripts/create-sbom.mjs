import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const destination = join(root, "release/sbom.cdx.json");
execFileSync("pnpm", [
  "sbom", "--sbom-format", "cyclonedx", "--sbom-spec-version", "1.6",
  "--sbom-type", "application", "--sbom-supplier", "SparkTales", "--prod",
  "--out", destination,
], { cwd: root, stdio: "inherit" });

const platformRoot = process.env.LOCUS_PLATFORM_ROOT || join(root, "..", "locus-platform");
const requirementsPath = join(platformRoot, "agent/requirements-runtime.lock");
if (!existsSync(requirementsPath)) throw new Error(`Pinned agent requirements are missing at ${requirementsPath}`);
const requirements = readFileSync(requirementsPath, "utf8");
const pythonComponents = [...requirements.matchAll(/^([A-Za-z0-9_.-]+)==([^\s\\]+)\s*\\/gm)].map((match) => {
  const name = match[1];
  const version = match[2];
  const normalized = name.toLowerCase().replaceAll("_", "-");
  return {
    type: "library",
    name,
    version,
    purl: `pkg:pypi/${normalized}@${version}`,
    properties: [{ name: "locus:runtime", value: "embedded-agent" }],
  };
});
pythonComponents.unshift({
  type: "application",
  name: "CPython",
  version: "3.14.6",
  purl: "pkg:generic/cpython@3.14.6?arch=arm64&os=macos",
  properties: [{ name: "locus:runtime", value: "embedded-agent" }],
});
const sbom = JSON.parse(readFileSync(destination, "utf8"));
const byPurl = new Map((sbom.components ?? []).map((component) => [component.purl ?? `${component.name}@${component.version}`, component]));
for (const component of pythonComponents) byPurl.set(component.purl, component);
sbom.components = [...byPurl.values()].sort((left, right) =>
  `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`));
sbom.metadata ??= {};
sbom.metadata.properties = [
  ...(sbom.metadata.properties ?? []),
  { name: "locus:embedded-python-components", value: String(pythonComponents.length) },
];
const provenance = join(root, "apps/desktop/build/AgentRuntime/PROVENANCE");
if (existsSync(provenance)) {
  const revision = /^platform_revision=(.+)$/m.exec(readFileSync(provenance, "utf8"))?.[1];
  if (revision) sbom.metadata.properties.push({ name: "locus:platform-revision", value: revision });
}
writeFileSync(destination, `${JSON.stringify(sbom, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`Augmented CycloneDX SBOM with ${pythonComponents.length} embedded Python components.\n`);
