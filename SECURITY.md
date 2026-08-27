# Security model

Locus Browser treats every webpage and extension as hostile content.

- Remote tabs run with Node disabled, sandboxing enabled, context isolation,
  web security enabled, and no preload API.
- Only the trusted local shell and Work renderer receive the narrow,
  schema-validated preload bridge.
- Browser tools are authorized in the main-process broker against a session and
  tab grant. Model-supplied access metadata is informational only.
- Private, internal, local-file, settings, password, and extension-management
  pages cannot be granted.
- Credential-, payment-, passkey-, recovery-, and one-time-code-shaped fields
  are hidden from page reads, input, JavaScript, and screenshots. Cross-origin
  frames are covered in agent screenshots because their field contents cannot
  be inspected safely.
- Agent downloads are capped at 25 MB and placed in the app-owned quarantine.
- Password material is encrypted with Electron `safeStorage`, is indexed only
  by origin and username, and requires a main-process user-gesture assertion to
  reveal.
- Unpacked extensions require an explicitly warned per-profile Developer Mode
  and native permission review. Their folders are bounded and revalidated for
  symlinks, path escapes, unsupported capabilities, remote code, and changes
  between review and load. They never run in Private Windows or enter sync.
- Signed `.locusx` packages require an Ed25519 publisher signature and a
  countersignature from a compiled-in gallery key. The archive is bounded
  before extraction, every path and SHA-256 inventory entry is checked, and
  only reviewed files are written with private permissions to profile-owned
  storage. Updates preserve publisher identity and a verified prior version is
  retained for rollback. The included key is canary-only and must be rotated
  before beta distribution.
- Gallery catalog and revocation documents require an Ed25519 signature from a
  compiled-in trust key. Only the Electron main process fetches them, redirects
  are rejected, package paths stay on the sealed HTTPS origin, and documents/
  downloads have strict size and time limits. The last verified revocation
  document is retained for offline enforcement. Downloads are streamed to
  private temporary storage and must match catalog size and SHA-256, but install
  still depends on independent publisher/gallery package signatures.
- Sync encryption happens before upload. The service receives ciphertext and
  routing metadata only; large envelopes may move to S3-compatible storage but
  remain client-encrypted and size-verified. Passwords, cookies, site storage,
  AI sessions, credentials, and workspace/run data have no sync collection.
- Walrus Memory is opt-in and disabled in Private Windows. Page writes require
  an explicitly shared HTTP(S) tab, a strict protected-field-excluding snapshot,
  an exact preview, and a second confirmation. Research writes omit captured
  passages. The delegate key is entered natively, OS-encrypted per profile, and
  excluded from renderer state, agent messages, logs, and sync. Hosted mode is
  not end-to-end private from the managed relayer: it processes plaintext for
  embedding and encryption. Client-encrypted mode instead embeds and
  SEAL-encrypts in the private intelligence utility; its explicitly selected
  embedding provider still receives plaintext. The dedicated Sui and embedding
  credentials are separately OS-encrypted and are never borrowed from Work.
  Recalled text is bounded, provenance-preserving, attached manually, and
  wrapped by the runtime as untrusted evidence.
- Verifiable Research Bundles publish only claims, citations, URLs, source and
  passage hashes by default. Captured passage text requires a separate warning
  and confirmation. Locus signs the canonical manifest with the dedicated Sui
  signer, verifies that signature locally, checks every previewed artifact hash
  again inside the private utility, and stores only content-free quilt receipts.
- Packaged gallery and sync origins are sealed into the signed application.
  Missing or malformed release configuration disables those services, and
  environment variables cannot redirect a packaged client.

Please use GitHub private vulnerability reporting to contact the project
maintainers. Do not
include credentials, private browsing data, or decrypted sync records in a
public issue.
