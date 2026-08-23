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
- Gallery catalog data is treated as untrusted discovery metadata. Only the
  Electron main process fetches it, redirects are rejected, HTTPS is required
  outside localhost, package paths must stay on the configured origin, and
  catalogs/downloads have strict size and time limits. Downloads are streamed
  to private temporary storage and must match the catalog size and SHA-256,
  but installation still depends on the independent publisher/gallery
  signature checks above.
- Sync encryption happens before upload. The service receives ciphertext and
  routing metadata only; passwords, cookies, site storage, AI sessions,
  credentials, and workspace/run data have no sync collection.

Please report vulnerabilities privately to the project maintainers. Do not
include credentials, private browsing data, or decrypted sync records in a
public issue.
