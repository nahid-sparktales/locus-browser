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
- Sync encryption happens before upload. The service receives ciphertext and
  routing metadata only; passwords, cookies, site storage, AI sessions,
  credentials, and workspace/run data have no sync collection.

Please report vulnerabilities privately to the project maintainers. Do not
include credentials, private browsing data, or decrypted sync records in a
public issue.
