import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { ExtensionRevocationDocumentSchema } from "@locus/extensions";
import { signGalleryPublication } from "./publication.js";
import { DirectoryExtensionGallery } from "./repository.js";

const packageDirectory = resolve(required("LOCUS_GALLERY_PACKAGES"));
const metadataDirectory = resolve(required("LOCUS_GALLERY_METADATA"));
const signingKeyPath = resolve(required("LOCUS_GALLERY_SIGNING_KEY_FILE"));
const revocationsPath = process.env.LOCUS_GALLERY_REVOCATIONS
  ? resolve(process.env.LOCUS_GALLERY_REVOCATIONS)
  : undefined;
const gallery = await DirectoryExtensionGallery.open(packageDirectory);
const revocations = revocationsPath
  ? ExtensionRevocationDocumentSchema.parse(JSON.parse(await readFile(revocationsPath, "utf8")))
  : ExtensionRevocationDocumentSchema.parse({
    version: 1,
    generatedAt: Math.floor(Date.now() / 1_000),
    revocations: [],
  });
const publication = signGalleryPublication(gallery.catalog(), revocations, await readFile(signingKeyPath, "utf8"));
await mkdir(metadataDirectory, { recursive: true, mode: 0o700 });
await writeAtomic("catalog.json", publication.catalog);
await writeAtomic("revocations.json", publication.revocations);
process.stdout.write(`Published signed metadata for ${gallery.catalog().extensions.length} extensions and ${revocations.revocations.length} revocations.\n`);

async function writeAtomic(name: string, value: unknown): Promise<void> {
  const destination = join(metadataDirectory, name);
  const temporary = `${destination}.next`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, destination);
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
