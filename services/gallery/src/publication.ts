import { createPrivateKey, createPublicKey, sign } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  ExtensionRevocationDocumentSchema,
  SignedExtensionGalleryCatalogSchema,
  SignedExtensionRevocationsSchema,
  extensionGalleryDocumentMessage,
  publicKeyFingerprint,
  verifySignedExtensionCatalog,
  verifySignedExtensionRevocations,
  type ExtensionGalleryCatalog,
  type ExtensionRevocationDocument,
  type SignedExtensionGalleryCatalog,
  type SignedExtensionRevocations,
} from "@locus/extensions";

export interface GalleryPublication {
  catalog: SignedExtensionGalleryCatalog;
  revocations: SignedExtensionRevocations;
}

export function signGalleryPublication(
  catalog: ExtensionGalleryCatalog,
  revocations: ExtensionRevocationDocument,
  privateKeyPem: string,
): GalleryPublication {
  const privateKey = createPrivateKey(privateKeyPem);
  if (privateKey.asymmetricKeyType !== "ed25519") throw new Error("Gallery documents require an Ed25519 key");
  const publicKeyPem = createPublicKey(privateKey).export({ format: "pem", type: "spki" }).toString();
  const fingerprint = publicKeyFingerprint(publicKeyPem);
  return {
    catalog: SignedExtensionGalleryCatalogSchema.parse(signed("catalog", catalog)),
    revocations: SignedExtensionRevocationsSchema.parse(signed("revocations", ExtensionRevocationDocumentSchema.parse(revocations))),
  };

  function signed(kind: "catalog" | "revocations", payload: unknown) {
    return {
      documentVersion: 1,
      kind,
      payload,
      signature: {
        algorithm: "Ed25519",
        publicKeyPem,
        fingerprint,
        value: sign(null, extensionGalleryDocumentMessage(kind, payload), privateKey).toString("base64"),
      },
    };
  }
}

export async function loadGalleryPublication(
  metadataDirectory: string,
  expectedCatalog: ExtensionGalleryCatalog,
  trustedFingerprints: ReadonlySet<string>,
): Promise<GalleryPublication> {
  const catalog = SignedExtensionGalleryCatalogSchema.parse(JSON.parse(await readFile(join(metadataDirectory, "catalog.json"), "utf8")));
  const revocations = SignedExtensionRevocationsSchema.parse(JSON.parse(await readFile(join(metadataDirectory, "revocations.json"), "utf8")));
  const verifiedCatalog = verifySignedExtensionCatalog(catalog, trustedFingerprints);
  verifySignedExtensionRevocations(revocations, trustedFingerprints);
  if (JSON.stringify(verifiedCatalog) !== JSON.stringify(expectedCatalog)) {
    throw new Error("Signed catalog does not match the verified package directory");
  }
  return { catalog, revocations };
}
