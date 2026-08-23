# Signed `.locusx` package contract

Contract version 2 is a ZIP archive with three required roots:

- `manifest.json` — the supported Manifest V3 subset.
- `inventory.json` — every extension file, including `manifest.json`, with its
  exact path, byte size, and lowercase SHA-256 digest.
- `signatures.json` — the stable extension identity and both Ed25519 signatures.

`inventory.json` and `signatures.json` are verification metadata. They are not
copied into the installed extension directory. No uninventoried extension file
is accepted. The manifest's `key` is required to be the Base64-encoded DER form
of the publisher public key, keeping Chromium's runtime extension ID and local
extension storage stable when a verified update moves to a new managed path.

## Signature envelope

```json
{
  "contractVersion": 2,
  "extensionId": "com.example.extension",
  "publisher": {
    "publicKeyPem": "-----BEGIN PUBLIC KEY-----…",
    "signature": "base64-ed25519-signature"
  },
  "gallery": {
    "publicKeyPem": "-----BEGIN PUBLIC KEY-----…",
    "signature": "base64-ed25519-signature"
  }
}
```

The publisher signs this UTF-8 message:

```text
2:<extensionId>:<sha256(manifest.json bytes)>:<sha256(inventory.json bytes)>
```

The gallery countersigns this UTF-8 message:

```text
<sha256(publisher message)>:<publisher public-key fingerprint>:<sha256(publisher signature bytes)>
```

The public-key fingerprint is SHA-256 over the PEM after removing whitespace.
This binds the stable extension ID, exact manifest, full file inventory,
publisher identity, and publisher signature to the gallery review.

## Verification and storage rules

- Archive and expanded contents are each limited to 50 MB.
- At most 5,002 ZIP entries are accepted; individual expanded files are capped
  at 25 MB and the signed inventory at 5,000 files.
- Empty, absolute, repeated, dot-segment, backslash, NUL, duplicate archive,
  duplicate inventory, path-escape, symlink, and special-file inputs are
  rejected.
- Only supported manifest keys and permission groups are accepted. Executable
  files are scanned for remote or dynamic code before installation.
- The gallery public-key fingerprint must match a key compiled into the app.
- The manifest `key` must match the verified publisher public key.
- The package is verified again after native permission review. Its fingerprint,
  ID, and version must match the reviewed values.
- Extracted files use private permissions in a canonical, profile-specific
  application directory. Existing copies must match the signed bytes exactly.
- An update must retain the publisher fingerprint, increase the semantic
  version, and request native review for newly expanded permissions. Previous
  verified versions remain available for rollback.

The repository contains only the public fingerprint of the current canary
gallery key. Test packages use ephemeral keys. A production key ceremony,
rotation policy, publisher enrollment process, malware review pipeline, and
gallery rollout service remain launch requirements.
