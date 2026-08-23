import { join } from "node:path";
import { createExtensionGalleryApp } from "./app.js";
import { DirectoryExtensionGallery } from "./repository.js";

const packageDirectory = process.env.LOCUS_GALLERY_PACKAGES || join(process.cwd(), "gallery-packages");
const gallery = await DirectoryExtensionGallery.open(packageDirectory);
const server = createExtensionGalleryApp(gallery);
await server.listen({
  host: process.env.HOST || "127.0.0.1",
  port: Number(process.env.PORT || 8790),
});
