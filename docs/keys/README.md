# Canary public signing keys

These public keys make the canary trust roots auditable without publishing
private signing material.

- Extension gallery: `locus-canary-gallery-2026-08-public.pem`
  - Fingerprint: `d1257f8fe1c98e28efeb83b9fa1755cca4e82aa0360391bb73a7b054b161f10d`
  - The fingerprint is SHA-256 over the whitespace-normalized SPKI PEM, matching
    `publicKeyFingerprint` in `@locus/extensions`.
- Release manifest: `locus-canary-release-2026-08-public.pem`
  - Fingerprint: `082a491f8a5806be6bb9540b2918c96b47a84da53de60bf10ca9d4cd3d0488b3`
  - The fingerprint is SHA-256 over the DER-encoded SPKI public key, matching
    the release-manifest generator.

The two keys are independent and cannot substitute for one another. Their
private keys are stored outside Git and Cloudflare in macOS Keychain plus
encrypted local backups. Gallery documents and extension countersignatures are
created offline. The release key is available only to the protected GitHub
`canary` environment.
