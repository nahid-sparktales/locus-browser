# Production extension gallery Worker

This Worker is the only public origin for the curated Locus extension gallery.
It serves signed catalog and revocation documents plus immutable `.locusx`
packages from a private R2 binding. R2 has no public development URL and the
Worker exposes only the documented read-only routes.

The gallery signing key is deliberately absent from Cloudflare and this
repository. Publication happens offline: first generate `catalog.json` and
`revocations.json` with the Node gallery service, then upload the fully reviewed
publication and deploy the Worker.

```bash
LOCUS_GALLERY_PACKAGES=/reviewed/packages \
LOCUS_GALLERY_METADATA=/reviewed/metadata \
pnpm --filter @locus/gallery-worker publish:production

pnpm --filter @locus/gallery-worker run deploy

LOCUS_EXTENSION_GALLERY_URL=https://extensions.locushost.co \
pnpm --filter @locus/gallery-worker verify:deployment
```

`/health` fails closed unless both signed documents exist in R2 and declare the
fingerprint compiled into the Worker and desktop. Package downloads must appear
in the signed catalog, match its exact byte size, and use immutable SHA-256
response metadata. The desktop then independently verifies the document
signature, archive hash, publisher signature, gallery countersignature,
permissions, inventory, and remote-code policy before installation.
