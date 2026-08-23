import { createHash, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  locusxContractVersion,
  locusxGalleryMessage,
  locusxPublisherMessage,
  publicKeyFingerprint,
} from "@locus/extensions";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { createExtensionGalleryApp } from "./app.js";
import { DirectoryExtensionGallery } from "./repository.js";

describe("extension gallery service", () => {
  it("publishes only the latest verified package with cache and integrity metadata", async () => {
    const root = mkdtempSync(join(tmpdir(), "locus-gallery-service-"));
    const galleryKeys = generateKeyPairSync("ed25519");
    const publisherKeys = generateKeyPairSync("ed25519");
    const galleryFingerprint = publicKeyFingerprint(publicPem(galleryKeys.publicKey));
    writePackage(join(root, "notes-1.0.0.locusx"), "1.0.0", galleryKeys, publisherKeys);
    const latestBytes = writePackage(join(root, "notes-1.2.0.locusx"), "1.2.0", galleryKeys, publisherKeys);
    const repository = await DirectoryExtensionGallery.open(root, new Set([galleryFingerprint]));
    const app = createExtensionGalleryApp(repository);

    const catalog = await app.inject({ method: "GET", url: "/v1/extensions" });
    expect(catalog.statusCode).toBe(200);
    expect(catalog.headers["cache-control"]).toContain("max-age=300");
    expect(catalog.json()).toMatchObject({
      catalogVersion: 1,
      packageContractVersion: 2,
      extensions: [{ id: "dev.locus.reading-notes", version: "1.2.0", packageSize: latestBytes.byteLength }],
    });
    const notModified = await app.inject({
      method: "GET",
      url: "/v1/extensions",
      headers: { "if-none-match": catalog.headers.etag! },
    });
    expect(notModified.statusCode).toBe(304);

    const downloadPath = catalog.json().extensions[0].downloadPath as string;
    const download = await app.inject({ method: "GET", url: downloadPath });
    expect(download.statusCode).toBe(200);
    expect(download.headers["content-type"]).toContain("application/vnd.locus.extension+zip");
    expect(createHash("sha256").update(download.rawPayload).digest("hex")).toBe(catalog.json().extensions[0].packageSha256);
    expect((await app.inject({ method: "GET", url: "/v1/extensions/dev.locus.reading-notes/9.0.0/download" })).statusCode).toBe(404);
    await app.close();
  });

  it("fails closed when a package is not signed by an allowed gallery", async () => {
    const root = mkdtempSync(join(tmpdir(), "locus-gallery-untrusted-"));
    const galleryKeys = generateKeyPairSync("ed25519");
    const publisherKeys = generateKeyPairSync("ed25519");
    writePackage(join(root, "notes.locusx"), "1.0.0", galleryKeys, publisherKeys);
    await expect(DirectoryExtensionGallery.open(root, new Set())).rejects.toThrow("Gallery signing key is not trusted");
  });
});

function writePackage(
  path: string,
  version: string,
  gallery: { publicKey: KeyObject; privateKey: KeyObject },
  publisher: { publicKey: KeyObject; privateKey: KeyObject },
): Uint8Array {
  const manifest = strToU8(JSON.stringify({
    manifest_version: 3,
    name: "Reading Notes",
    version,
    description: "Save selected passages locally.",
    key: publisher.publicKey.export({ format: "der", type: "spki" }).toString("base64"),
    permissions: ["storage"],
    host_permissions: ["https://example.com/*"],
    content_scripts: [{ matches: ["https://example.com/*"], js: ["content.js"] }],
  }));
  const script = strToU8(`document.documentElement.dataset.locusGallery = ${JSON.stringify(version)};`);
  const inventory = strToU8(JSON.stringify({ files: [
    { path: "manifest.json", sha256: digest(manifest), size: manifest.byteLength },
    { path: "content.js", sha256: digest(script), size: script.byteLength },
  ] }));
  const publisherPem = publicPem(publisher.publicKey);
  const publisherMessage = locusxPublisherMessage("dev.locus.reading-notes", manifest, inventory);
  const publisherSignature = sign(null, publisherMessage, publisher.privateKey);
  const galleryMessage = locusxGalleryMessage(publisherMessage, publicKeyFingerprint(publisherPem), publisherSignature);
  const signatures = strToU8(JSON.stringify({
    contractVersion: locusxContractVersion,
    extensionId: "dev.locus.reading-notes",
    publisher: { publicKeyPem: publisherPem, signature: publisherSignature.toString("base64") },
    gallery: { publicKeyPem: publicPem(gallery.publicKey), signature: sign(null, galleryMessage, gallery.privateKey).toString("base64") },
  }));
  const archive = zipSync({
    "manifest.json": manifest,
    "content.js": script,
    "inventory.json": inventory,
    "signatures.json": signatures,
  });
  writeFileSync(path, archive, { mode: 0o600 });
  return archive;
}

function publicPem(key: KeyObject): string {
  return key.export({ format: "pem", type: "spki" }).toString();
}

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
