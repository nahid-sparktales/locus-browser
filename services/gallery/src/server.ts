import { join } from "node:path";
import { generateKeyPairSync } from "node:crypto";
import { trustedGalleryFingerprints } from "@locus/extensions";
import { createExtensionGalleryApp } from "./app.js";
import { loadGalleryPublication, signGalleryPublication } from "./publication.js";
import { DirectoryExtensionGallery } from "./repository.js";

const packageDirectory = process.env.LOCUS_GALLERY_PACKAGES || join(process.cwd(), "gallery-packages");
const gallery = await DirectoryExtensionGallery.open(packageDirectory);
const mode = process.env.LOCUS_GALLERY_MODE || "production";
const metadataDirectory = process.env.LOCUS_GALLERY_METADATA || join(process.cwd(), "gallery-metadata");
let publication;
if (mode === "production") {
  publication = await loadGalleryPublication(metadataDirectory, gallery.catalog(), trustedGalleryFingerprints);
} else {
  const privateKeyPem = process.env.LOCUS_GALLERY_DEVELOPMENT_PRIVATE_KEY
    ? Buffer.from(process.env.LOCUS_GALLERY_DEVELOPMENT_PRIVATE_KEY, "base64").toString("utf8")
    : generateKeyPairSync("ed25519").privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  publication = signGalleryPublication(gallery.catalog(), {
    version: 1,
    generatedAt: Math.floor(Date.now() / 1_000),
    revocations: [],
  }, privateKeyPem);
}
const server = createExtensionGalleryApp(gallery, publication, { production: mode === "production" });
await server.listen({
  host: process.env.HOST || "127.0.0.1",
  port: Number(process.env.PORT || 8790),
});
