import { describe, expect, it } from "vitest";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { verifyPersonalMessageSignature } from "@mysten/sui/verify";
import { signResearchBundleManifest } from "./ResearchBundleCrypto.js";

describe("research-bundle manifest signatures", () => {
  it("signs a canonical personal message and verifies the signer locally", async () => {
    const signer = Ed25519Keypair.generate();
    const result = await signResearchBundleManifest({
      format: "locus-research-bundle-v1",
      boardId: "board-1",
      files: [{ identifier: "board.json", sha256: "a".repeat(64) }],
    }, signer);
    expect(result.signerAddress).toBe(signer.toSuiAddress());
    expect(result.manifestSha256).toMatch(/^[a-f0-9]{64}$/);
    const manifest = JSON.parse(new TextDecoder().decode(result.manifestBytes)) as { signature?: { signature?: string; signerAddress?: string } };
    expect(manifest.signature).toMatchObject({ signature: result.signature, signerAddress: signer.toSuiAddress() });
    await expect(verifyPersonalMessageSignature(result.signedMessage, result.signature, { address: signer.toSuiAddress() })).resolves.toBeDefined();
  });
});
