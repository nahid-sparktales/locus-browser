export interface WalrusManualConfiguration {
  delegateKey: string;
  suiPrivateKey: string;
  embeddingApiKey: string;
  accountId: string;
  namespace: string;
  relayerUrl: string;
  network: "mainnet" | "testnet";
  packageId: string;
  registryId: string;
  embeddingApiBase: string;
  embeddingModel: string;
}

export interface WalrusManualConfigurationResult {
  signerAddress: string;
}

export interface WalrusBundleSourceFile {
  identifier: "board.json" | "research.md" | "research.pdf";
  mediaType: string;
  contentsBase64: string;
  sha256: string;
}

export interface WalrusBundlePublishInput {
  receiptId: string;
  boardId: string;
  namespace: string;
  visibility: "public" | "seal-encrypted";
  network: "mainnet" | "testnet";
  epochs: number;
  files: WalrusBundleSourceFile[];
  unsignedManifest: Record<string, unknown>;
}

export interface WalrusBundlePublishResult {
  quiltId: string;
  manifestSha256: string;
  signerAddress: string;
  files: Array<{ identifier: string; id: string; blobId: string }>;
}
