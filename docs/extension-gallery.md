# Curated extension gallery

The gallery is a read-only discovery and delivery service. It does not grant
extension trust: the desktop independently verifies every downloaded `.locusx`
publisher signature, trusted-gallery countersignature, manifest, inventory, and
permission request before installation.

## API contract

- `GET /health` — process health and number of published stable IDs.
- `GET /v1/extensions` — catalog version 1 with the latest verified package for
  each signed extension ID in a signed document. Supports ETag revalidation.
- `GET /v1/revocations` — independently signed security/takedown notices.
- `GET /v1/extensions/:id/:version/download` — immutable package bytes with
  content length, ETag, and SHA-256 `Digest` metadata.

Catalog entries contain display metadata, tested permission groups, host access,
publisher/gallery fingerprints, exact package size and SHA-256, and a canonical
same-origin download path. Optional rollout percentage and seed assign clients
to deterministic cohorts. The package remains the source of truth.

## Local operation

```bash
mkdir gallery-packages
# Copy canary-signed .locusx packages into gallery-packages.
docker compose -f compose.gallery.yaml up --build
LOCUS_EXTENSION_GALLERY_URL=http://127.0.0.1:8790 \
LOCUS_GALLERY_TRUST_DEVELOPMENT_DOCUMENTS=1 pnpm dev:desktop
```

That trust override is accepted only by an unpackaged development app. Packaged
builds ignore it and accept only compiled gallery fingerprints.

The local stack creates an ephemeral development document signer. The service
scans only direct `.locusx` files, rejects links and oversized files, and fails
startup on an invalid signature, duplicate ID/version, unsupported capability,
unsafe resource, remote code, or package outside the configured directory.

## Production publication

Production mode refuses to start without `catalog.json` and `revocations.json`
signed by a trusted offline gallery key. It also requires the signed catalog to
match the verified package directory exactly.

```bash
LOCUS_GALLERY_PACKAGES=/reviewed/packages \
LOCUS_GALLERY_METADATA=/publication/metadata \
LOCUS_GALLERY_SIGNING_KEY_FILE=/offline/gallery-ed25519.pem \
LOCUS_GALLERY_REVOCATIONS=/review/revocations.json \
pnpm --filter @locus/extension-gallery-service publish:metadata
```

The production read path is a Cloudflare Worker at
`https://extensions.locushost.co` backed by the private
`locus-browser-extension-gallery-production` R2 bucket. Cloudflare does not
hold either signing private key. Upload the immutable packages and signed
documents, deploy the Worker, and cryptographically verify the live publication:

```bash
LOCUS_GALLERY_PACKAGES=/reviewed/packages \
LOCUS_GALLERY_METADATA=/publication/metadata \
pnpm --filter @locus/gallery-worker publish:production

pnpm --filter @locus/gallery-worker run deploy

LOCUS_EXTENSION_GALLERY_URL=https://extensions.locushost.co \
pnpm --filter @locus/gallery-worker verify:deployment
```

The Worker streams package bodies, serves short-lived signed metadata and
immutable package caches, rejects writes and ranges, rate limits reads, and
fails closed when metadata is missing, oversized, malformed, or signed by an
unexpected fingerprint. The desktop repeats the full signature, package,
permission, and inventory verification before installation.

The container configuration in `deploy/gallery/compose.production.yaml`
remains available for a self-hosted deployment or local production rehearsal.

For an emergency takedown, add an extension, version, publisher, or gallery-key
revocation; sign and deploy the new revocation document before removing the
package from discovery. Clients retain and enforce the last verified security
document when the service is offline.

## Controls required before publishing the first extension

- Add authenticated publisher enrollment, isolated build/review workers,
  malware and remote-code analysis, reproducible reports, and human approval.
- Exercise gallery-key rotation/revocation and R2 backup/restore procedures.
- Complete external review of the package pipeline and desktop extension/update
  path before admitting third-party packages.
