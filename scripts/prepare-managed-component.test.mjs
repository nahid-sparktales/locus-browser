import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  assertPinnedFile,
  readManagedComponentManifest,
  sha256File,
  validateManagedComponentManifest,
} from "./prepare-managed-component.mjs";

const validManifest = {
  schema_version: 1,
  id: "openai-codex-app-server",
  name: "OpenAI Codex App Server",
  version: "0.147.0",
  license: "Apache-2.0",
  documentation_url: "https://learn.chatgpt.com/docs/app-server",
  source_url: "https://www.npmjs.com/package/@openai/codex/v/0.147.0",
  targets: {
    "darwin-arm64": {
      package: "@openai/codex",
      package_version: "0.147.0-darwin-arm64",
      archive_url: "https://registry.npmjs.org/@openai/codex/-/codex-0.147.0-darwin-arm64.tgz",
      archive_sha256: "a".repeat(64),
      archive_size: 10,
      executable_path: "package/vendor/aarch64-apple-darwin/bin/codex",
      executable_sha256: "b".repeat(64),
      executable_size: 20,
      upstream_signing_team_id: "2DC432GLL2",
    },
  },
};

test("accepts the exact pinned Apple Silicon component contract", () => {
  const result = validateManagedComponentManifest(validManifest);
  assert.equal(result.version, "0.147.0");
  assert.equal(result.target.package_version, "0.147.0-darwin-arm64");
});

test("rejects untrusted download origins and path traversal", () => {
  assert.throws(() => validateManagedComponentManifest({
    ...validManifest,
    targets: { "darwin-arm64": { ...validManifest.targets["darwin-arm64"], archive_url: "https://example.com/codex.tgz" } },
  }), /registry\.npmjs\.org/);
  assert.throws(() => validateManagedComponentManifest({
    ...validManifest,
    targets: { "darwin-arm64": { ...validManifest.targets["darwin-arm64"], executable_path: "../codex" } },
  }), /remain inside/);
});

test("reads a manifest and validates staged file size and digest", () => {
  const directory = mkdtempSync(join(tmpdir(), "locus-component-test."));
  const manifestPath = join(directory, "component.json");
  const filePath = join(directory, "component");
  writeFileSync(manifestPath, JSON.stringify(validManifest));
  writeFileSync(filePath, "managed-component");
  assert.equal(readManagedComponentManifest(manifestPath).id, validManifest.id);
  assertPinnedFile(filePath, 17, sha256File(filePath), "fixture");
  assert.throws(() => assertPinnedFile(filePath, 18, sha256File(filePath), "fixture"), /size mismatch/);
});
