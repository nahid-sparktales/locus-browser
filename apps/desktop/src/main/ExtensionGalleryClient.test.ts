import { createHash, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extensionGalleryDocumentMessage, extensionGalleryDownloadPath, publicKeyFingerprint } from "@locus/extensions";
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
    const documents = galleryDocuments([entry]);
    const { origin, requests } = await serve((request, response) => {
      if (request.url === "/v1/extensions") {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify(documents.catalog));
        return;
      }
      if (request.url === "/v1/revocations") {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify(documents.revocations));
        return;
      }
      response.setHeader("content-type", "application/vnd.locus.extension+zip");
      response.setHeader("content-length", packageBytes.byteLength);
      response.end(packageBytes);
    });
    const client = new ExtensionGalleryClient(origin, mkdtempSync(join(tmpdir(), "locus-gallery-client-")), "client-a", documents.trusted);
    expect((await client.refresh()).extensions[0]).toMatchObject({ id: entry.id, version: entry.version });
    expect((await client.refresh()).extensions).toHaveLength(1);
    const downloaded = await client.download(entry.id);
    expect(readFileSync(downloaded.path)).toEqual(packageBytes);
    expect(requests.filter((request) => request.url === "/v1/revocations")).toHaveLength(2);
    await downloaded.dispose();
  });

  it("rejects insecure gallery origins and mismatched package content", async () => {
    expect(() => normalizeGalleryServiceUrl("http://gallery.example.com")).toThrow("HTTPS");
    expect(() => normalizeGalleryServiceUrl("https://user@gallery.example.com")).toThrow("origin");
    const advertised = Buffer.from("advertised");
    const entry = galleryEntry(advertised);
    const documents = galleryDocuments([entry]);
    const { origin } = await serve((request, response) => {
      if (request.url === "/v1/extensions") {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify(documents.catalog));
        return;
      }
      if (request.url === "/v1/revocations") {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify(documents.revocations));
        return;
      }
      const changed = Buffer.from("changed-on-server");
      response.setHeader("content-type", "application/octet-stream");
      response.setHeader("content-length", changed.byteLength);
      response.end(changed);
    });
    const client = new ExtensionGalleryClient(origin, mkdtempSync(join(tmpdir(), "locus-gallery-client-bad-")), "client-b", documents.trusted);
    await client.refresh();
    await expect(client.download(entry.id)).rejects.toThrow(/size|integrity/);
  });

  it("removes revoked packages and rejects tampered security documents", async () => {
    const entry = galleryEntry(Buffer.from("revoked"));
    const documents = galleryDocuments([entry], [{
      id: "reading-notes-security", extensionId: entry.id, version: entry.version,
      reason: "security", effectiveAt: 1,
    }]);
    const { origin } = await serve((request, response) => {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(request.url === "/v1/extensions" ? documents.catalog : documents.revocations));
    });
    const client = new ExtensionGalleryClient(origin, mkdtempSync(join(tmpdir(), "locus-gallery-client-revoked-")), "client-c", documents.trusted);
    expect((await client.refresh()).extensions).toEqual([]);
    expect(client.revocations()).toHaveLength(1);

    const tampered = structuredClone(documents);
    tampered.catalog.payload.extensions[0]!.name = "Tampered";
    const badServer = await serve((request, response) => {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(request.url === "/v1/extensions" ? tampered.catalog : tampered.revocations));
    });
    const badClient = new ExtensionGalleryClient(badServer.origin, mkdtempSync(join(tmpdir(), "locus-gallery-client-tampered-")), "client-d", documents.trusted);
    await expect(badClient.refresh()).rejects.toThrow("Invalid signed gallery catalog");
  });

  it("reuses only previously verified security documents while offline", async () => {
    const entry = galleryEntry(Buffer.from("cached"));
    const documents = galleryDocuments([entry], [{
      id: "offline-security", extensionId: entry.id, version: entry.version,
      reason: "security", effectiveAt: 1,
    }]);
    const server = await serve((request, response) => {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(request.url === "/v1/extensions" ? documents.catalog : documents.revocations));
    });
    const downloadRoot = mkdtempSync(join(tmpdir(), "locus-gallery-client-cache-"));
    const client = new ExtensionGalleryClient(server.origin, downloadRoot, "client-cache", documents.trusted);
    expect((await client.refresh()).extensions).toEqual([]);
    await new Promise<void>((resolve) => server.server.close(() => resolve()));
    expect((await client.refresh()).extensions).toEqual([]);
    expect(client.revocations()).toHaveLength(1);
  });

  it("accepts an explicit self-signed document override only when development trust is enabled", async () => {
    const entry = galleryEntry(Buffer.from("development"));
    const documents = galleryDocuments([entry]);
    const { origin } = await serve((request, response) => {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(request.url === "/v1/extensions" ? documents.catalog : documents.revocations));
    });
    const untrusted = new ExtensionGalleryClient(origin, mkdtempSync(join(tmpdir(), "locus-gallery-untrusted-")), "client-dev", new Set());
    await expect(untrusted.refresh()).rejects.toThrow("not trusted");
    const trustedForDevelopment = new ExtensionGalleryClient(
      origin,
      mkdtempSync(join(tmpdir(), "locus-gallery-development-")),
      "client-dev",
      new Set(),
      true,
    );
    await expect(trustedForDevelopment.refresh()).resolves.toMatchObject({ extensions: [{ id: entry.id }] });
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

function galleryDocuments(entries: ReturnType<typeof galleryEntry>[], revocations: Array<Record<string, unknown>> = []) {
  const key = generateKeyPairSync("ed25519");
  const publicKeyPem = key.publicKey.export({ format: "pem", type: "spki" }).toString();
  const fingerprint = publicKeyFingerprint(publicKeyPem);
  const catalogPayload = { catalogVersion: 1 as const, packageContractVersion: 2 as const, extensions: entries };
  const revocationPayload = { version: 1 as const, generatedAt: 1_787_408_000, revocations };
  return {
    catalog: signedDocument("catalog", catalogPayload, key, publicKeyPem, fingerprint),
    revocations: signedDocument("revocations", revocationPayload, key, publicKeyPem, fingerprint),
    trusted: new Set([fingerprint]),
  };
}

function signedDocument(
  kind: "catalog" | "revocations",
  payload: any,
  key: { publicKey: KeyObject; privateKey: KeyObject },
  publicKeyPem: string,
  fingerprint: string,
) {
  return {
    documentVersion: 1 as const,
    kind,
    payload,
    signature: {
      algorithm: "Ed25519" as const,
      publicKeyPem,
      fingerprint,
      value: sign(null, extensionGalleryDocumentMessage(kind, payload), key.privateKey).toString("base64"),
    },
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
  return { origin: `http://127.0.0.1:${address.port}`, requests, server };
}
