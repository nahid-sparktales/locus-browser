import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createUpdateMetadata } from "./create-update-metadata.mjs";

test("creates the macOS canary feed from the packaged ZIP", async (t) => {
  const releaseRoot = mkdtempSync(join(tmpdir(), "locus-update-feed-"));
  t.after(() => rmSync(releaseRoot, { recursive: true }));
  const version = "0.1.0-canary.3";
  const zipName = `Locus-Browser-${version}-arm64.zip`;
  const fixture = Buffer.from("signed zip fixture");
  writeFileSync(join(releaseRoot, zipName), fixture);

  const result = await createUpdateMetadata({
    releaseRoot,
    version,
    releaseDate: "2026-08-24T00:00:00.000Z",
  });
  const expectedDigest = createHash("sha512").update(fixture).digest("base64");
  const metadata = readFileSync(result.output, "utf8");

  assert.equal(result.sha512, expectedDigest);
  assert.match(metadata, /version: "0\.1\.0-canary\.3"/);
  assert.match(metadata, new RegExp(`url: "${zipName.replaceAll(".", "\\.")}"`));
  assert.match(metadata, new RegExp(`sha512: "${expectedDigest.replaceAll("+", "\\+")}"`));
  assert.match(metadata, /size: 18/);
  assert.match(metadata, /releaseDate: "2026-08-24T00:00:00\.000Z"/);
});

test("rejects non-canary versions before writing a feed", async () => {
  await assert.rejects(
    createUpdateMetadata({ releaseRoot: tmpdir(), version: "1.0.0" }),
    /Cannot create canary metadata/,
  );
});
