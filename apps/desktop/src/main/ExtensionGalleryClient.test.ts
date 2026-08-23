import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extensionGalleryDownloadPath } from "@locus/extensions";
import { afterEach, describe, expect, it } from "vitest";
import { ExtensionGalleryClient, normalizeGalleryServiceUrl } from "./ExtensionGalleryClient.js";

const servers: Array<ReturnType<typeof createServer>> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe("ExtensionGalleryClient", () => {
  it("validates a catalog and streams a hash-pinned package to private temporary storage", async () => {
    const packageBytes = Buffer.from("signed-locus-package-fixture");
    const entry = galleryEntry(packageBytes);
    const { origin, requests } = await serve((request, response) => {
      if (request.url === "/v1/extensions") {
        response.setHeader("content-type", "application/json");
        response.setHeader("etag", '"catalog-a"');
        response.end(JSON.stringify({ catalogVersion: 1, packageContractVersion: 2, extensions: [entry] }));
        return;
      }
      response.setHeader("content-type", "application/vnd.locus.extension+zip");
      response.setHeader("content-length", packageBytes.byteLength);
      response.end(packageBytes);
    });
    const client = new ExtensionGalleryClient(origin, mkdtempSync(join(tmpdir(), "locus-gallery-client-")));
    expect((await client.refresh()).extensions[0]).toMatchObject({ id: entry.id, version: entry.version });
    expect((await client.refresh()).extensions).toHaveLength(1);
    const downloaded = await client.download(entry.id);
    expect(readFileSync(downloaded.path)).toEqual(packageBytes);
    expect(requests.filter((request) => request.url === "/v1/extensions")[1]?.headers["if-none-match"]).toBe('"catalog-a"');
    await downloaded.dispose();
  });

  it("rejects insecure gallery origins and mismatched package content", async () => {
    expect(() => normalizeGalleryServiceUrl("http://gallery.example.com")).toThrow("HTTPS");
    expect(() => normalizeGalleryServiceUrl("https://user@gallery.example.com")).toThrow("origin");
    const advertised = Buffer.from("advertised");
    const entry = galleryEntry(advertised);
    const { origin } = await serve((request, response) => {
      if (request.url === "/v1/extensions") {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ catalogVersion: 1, packageContractVersion: 2, extensions: [entry] }));
        return;
      }
      const changed = Buffer.from("changed-on-server");
      response.setHeader("content-type", "application/octet-stream");
      response.setHeader("content-length", changed.byteLength);
      response.end(changed);
    });
    const client = new ExtensionGalleryClient(origin, mkdtempSync(join(tmpdir(), "locus-gallery-client-bad-")));
    await client.refresh();
    await expect(client.download(entry.id)).rejects.toThrow(/size|integrity/);
  });
});

function galleryEntry(packageBytes: Uint8Array) {
  const id = "dev.locus.reading-notes";
  const version = "1.2.0";
  return {
    id,
    name: "Reading Notes",
    version,
    description: "Save selected passages locally.",
    publisherFingerprint: "a".repeat(64),
    galleryFingerprint: "b".repeat(64),
    packageSha256: createHash("sha256").update(packageBytes).digest("hex"),
    packageSize: packageBytes.byteLength,
    permissions: ["storage"],
    hostPermissions: ["https://example.com/*"],
    downloadPath: extensionGalleryDownloadPath(id, version),
  };
}

async function serve(handler: (request: IncomingMessage, response: ServerResponse) => void) {
  const requests: Array<{ url: string | undefined; headers: Record<string, string | string[] | undefined> }> = [];
  const server = createServer((request, response) => {
    requests.push({ url: request.url, headers: request.headers });
    handler(request, response);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test gallery did not bind");
  return { origin: `http://127.0.0.1:${address.port}`, requests };
}
