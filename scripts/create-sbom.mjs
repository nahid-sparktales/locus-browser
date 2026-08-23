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
const componentManifestPath = join(platformRoot, "agent/ollama_code/runtime_components/codex-app-server.json");
if (!existsSync(requirementsPath)) throw new Error(`Pinned agent requirements are missing at ${requirementsPath}`);
if (!existsSync(componentManifestPath)) throw new Error(`Pinned managed component manifest is missing at ${componentManifestPath}`);
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
const componentManifest = JSON.parse(readFileSync(componentManifestPath, "utf8"));
const componentTarget = componentManifest.targets["darwin-arm64"];
const managedComponent = {
  type: "application",
  name: componentManifest.name,
  version: componentManifest.version,
  purl: `pkg:npm/%40openai/codex@${componentTarget.package_version}?arch=arm64&os=macos`,
  hashes: [{ alg: "SHA-256", content: componentTarget.archive_sha256 }],
  licenses: [{ license: { id: componentManifest.license } }],
  externalReferences: [
    { type: "documentation", url: componentManifest.documentation_url },
    { type: "distribution", url: componentTarget.archive_url },
    { type: "vcs", url: "https://github.com/openai/codex" },
  ],
  properties: [
    { name: "locus:runtime", value: "managed-chatgpt" },
    { name: "locus:upstream-signing-team-id", value: componentTarget.upstream_signing_team_id },
  ],
};
const sbom = JSON.parse(readFileSync(destination, "utf8"));
const byPurl = new Map((sbom.components ?? []).map((component) => [component.purl ?? `${component.name}@${component.version}`, component]));
for (const component of pythonComponents) byPurl.set(component.purl, component);
byPurl.set(managedComponent.purl, managedComponent);
sbom.components = [...byPurl.values()].sort((left, right) =>
  `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`));
sbom.metadata ??= {};
sbom.metadata.properties = [
  ...(sbom.metadata.properties ?? []),
  { name: "locus:embedded-python-components", value: String(pythonComponents.length) },
  { name: "locus:managed-chatgpt-component", value: `${componentManifest.id}@${componentManifest.version}` },
];
const provenance = join(root, "apps/desktop/build/AgentRuntime/PROVENANCE");
if (existsSync(provenance)) {
  const revision = /^platform_revision=(.+)$/m.exec(readFileSync(provenance, "utf8"))?.[1];
  if (revision) sbom.metadata.properties.push({ name: "locus:platform-revision", value: revision });
}
writeFileSync(destination, `${JSON.stringify(sbom, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`Augmented CycloneDX SBOM with ${pythonComponents.length} embedded Python components and the pinned managed ChatGPT runtime.\n`);
