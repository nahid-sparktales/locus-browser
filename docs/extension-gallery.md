# Curated extension gallery

The gallery is a read-only discovery and delivery service. It does not grant
extension trust: the desktop independently verifies every downloaded `.locusx`
publisher signature, trusted-gallery countersignature, manifest, inventory, and
permission request before installation.

## API contract

- `GET /health` — process health and number of published stable IDs.
- `GET /v1/extensions` — catalog version 1 with the latest verified package for
  each signed extension ID. Supports ETag revalidation.
- `GET /v1/extensions/:id/:version/download` — immutable package bytes with
  content length, ETag, and SHA-256 `Digest` metadata.

Catalog entries contain display metadata, tested permission groups, host access,
publisher/gallery fingerprints, exact package size and SHA-256, and a canonical
same-origin download path. The package remains the source of truth.

## Local operation

```bash
mkdir gallery-packages
# Copy canary-signed .locusx packages into gallery-packages.
docker compose -f compose.gallery.yaml up --build
LOCUS_EXTENSION_GALLERY_URL=http://127.0.0.1:8790 pnpm dev:desktop
```

The service scans only direct `.locusx` files, rejects links and oversized files,
and fails startup on an invalid signature, duplicate ID/version, unsupported
capability, unsafe resource, remote code, or package outside the configured
directory. Publishing a package currently requires replacing the read-only
directory and restarting the service.

## Required before public deployment

- Replace the canary key through an offline production key ceremony with
  documented quorum, backup, rotation, and revocation procedures.
- Add authenticated publisher enrollment, isolated build/review workers,
  malware and remote-code analysis, reproducible reports, and human approval.
- Store approved immutable packages in object storage behind a CDN; add staged
  rollout, rollback, revocation/takedown, audit logs, monitoring, backups, and
  disaster recovery.
- Add signed catalog/revocation metadata for resilient mirrors and offline
  clients, plus rate limits and abuse controls.
- Complete external review of the service, package pipeline, and desktop update
  path before switching the packaged app to the production origin.
