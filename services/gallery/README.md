# Locus extension gallery service

This read-only service scans a directory of already signed `.locusx` packages,
fails startup if any package is invalid or untrusted, publishes only the latest
version of each stable extension ID, and serves immutable downloads with SHA-256
metadata. The desktop app still verifies every downloaded package independently
before showing the native permission review.

```bash
LOCUS_GALLERY_PACKAGES=/absolute/path/to/packages pnpm --filter @locus/extension-gallery-service dev
```

The current built-in key is canary-only. Do not deploy a public gallery until
the production offline key ceremony, publisher enrollment, malware review, and
key-rotation procedures are complete.
