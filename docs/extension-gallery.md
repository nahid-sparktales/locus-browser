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
pnpm --filter @locus/extension-gallery-service publish
```

Deploy the immutable packages and both signed documents as one publication.
The hardened container configuration in `deploy/gallery/compose.production.yaml`
uses a read-only filesystem, dropped capabilities, a bounded temporary volume,
rate limiting, and production fail-closed mode.

For an emergency takedown, add an extension, version, publisher, or gallery-key
revocation; sign and deploy the new revocation document before removing the
package from discovery. Clients retain and enforce the last verified security
document when the service is offline.

## External controls required before public deployment

- Replace the canary key through an offline production key ceremony with
  documented quorum, backup, rotation, and revocation procedures.
- Add authenticated publisher enrollment, isolated build/review workers,
  malware and remote-code analysis, reproducible reports, and human approval.
- Store approved immutable packages in object storage behind a CDN and operate
  audit logs, monitoring, backups, and disaster recovery.
- Complete external review of the service, package pipeline, and desktop update
  path before switching the packaged app to the production origin.
