import { createHash } from "node:crypto";
import type { Signer } from "@mysten/sui/cryptography";
import { verifyPersonalMessageSignature } from "@mysten/sui/verify";
import { canonicalJson } from "../shared/canonicalJson.js";

export const RESEARCH_BUNDLE_SIGNATURE_PREFIX = "Locus Research Bundle Manifest v1\n";

export async function signResearchBundleManifest(unsignedManifest: Record<string, unknown>, signer: Signer): Promise<{
  manifestBytes: Uint8Array;
  manifestSha256: string;
  signedMessage: Uint8Array;
  signature: string;
  signerAddress: string;
}> {
  const signedMessage = new TextEncoder().encode(`${RESEARCH_BUNDLE_SIGNATURE_PREFIX}${canonicalJson(unsignedManifest)}`);
  const signed = await signer.signPersonalMessage(signedMessage);
  const signerAddress = signer.toSuiAddress();
  await verifyPersonalMessageSignature(signedMessage, signed.signature, { address: signerAddress });
  const signedManifest = {
    ...unsignedManifest,
    signature: {
      scheme: "sui-personal-message",
      signerAddress,
      signature: signed.signature,
      signedMessageSha256: createHash("sha256").update(signedMessage).digest("hex"),
    },
  };
  const manifestBytes = new TextEncoder().encode(`${canonicalJson(signedManifest)}\n`);
  return {
    manifestBytes,
    manifestSha256: createHash("sha256").update(manifestBytes).digest("hex"),
    signedMessage,
    signature: signed.signature,
    signerAddress,
  };
}
