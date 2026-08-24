# Canary release runbook

This runbook turns a green `main` commit into a limited Apple Silicon macOS
canary. The source gate is automated; publishing still requires the controlled
Apple, service, and signing credentials listed below.

## Release scope

- macOS 14 or newer on Apple Silicon.
- Direct-download, signed and notarized DMG/ZIP distribution.
- Normal browsing plus the focused Solo Work surfaces: Chat, Plan, Changes,
  Files, and Terminal.
- The canary-tested MV3 subset recorded in `packages/extensions/registry.json`.
- Optional encrypted sync. Passwords, cookies, workspaces, AI conversations,
  provider credentials, and run records never enter sync.

## One-time environment setup

Create a protected GitHub `canary` environment with required reviewer approval.
Configure these secrets:

- `APPLE_CERTIFICATE_P12` — base64 Developer ID Application certificate.
- `APPLE_CERTIFICATE_PASSWORD` and `KEYCHAIN_PASSWORD`.
- `APPLE_API_KEY_P8`, `APPLE_API_KEY_ID`, and `APPLE_API_ISSUER` for notarization.
- `LOCUS_RELEASE_SIGNING_PRIVATE_KEY` — base64 PEM Ed25519 private key kept
  independently of the extension-gallery signing key.

Configure these environment variables:

- `LOCUS_PLATFORM_REF` — an immutable tagged `locus-platform` release.
- `LOCUS_EXTENSION_GALLERY_URL` — the controlled credential-free HTTPS origin.
- `LOCUS_SYNC_URL` — the controlled credential-free HTTPS origin.

Enable GitHub private vulnerability reporting and branch protection for `main`.
The production gallery signing key stays offline; the gallery host receives
only signed `catalog.json` and `revocations.json` documents.

## Service readiness

Before tagging, deploy the gallery and sync stacks to their canary origins and
verify:

1. Complete [`sync-deployment.md`](sync-deployment.md): the dedicated Supabase
   migration and permission query pass, Hyperdrive uses the direct endpoint and
   `locus_sync_runtime` role, the R2 bucket has no public access, and the Worker
   is attached to the final HTTPS hostname.
2. The gallery package directory is immutable. Generate signed metadata with
   `pnpm --filter @locus/extension-gallery-service publish` on the offline
   signer, then deploy the packages and signed documents together.
3. `/health`, `/v1/extensions`, and `/v1/revocations` return successfully.
   Verify the document fingerprints against the key compiled into the desktop.
4. `pnpm sync:verify-deployment` passes against the exact `LOCUS_SYNC_URL`.
   Passkey registration uses that hostname as the exact RP ID and HTTPS origin.
5. A two-device sync rehearsal covers offline writes, recovery, revocation,
   cloud deletion, and a large record stored through the S3-compatible backend.

## Create a canary

1. Update both package versions to `X.Y.Z-canary.N` and update the changelog.
2. Pin `LOCUS_PLATFORM_REF` to the reviewed platform tag.
3. Run locally:

   ```bash
   pnpm install --frozen-lockfile
   pnpm canary:check
   pnpm typecheck
   pnpm test
   pnpm build
   pnpm --filter @locus/browser-desktop compat:extensions
   pnpm --filter @locus/browser-desktop acceptance:ui
   pnpm audit --audit-level high
   ```

4. Merge only after Browser CI is green.
5. Create and push the exact tag `canary-vX.Y.Z-canary.N`. The protected
   `Publish Canary` workflow imports the Developer ID identity, embeds the
   Python runtime and integrity-pinned OpenAI Codex App Server, seals the two
   production service origins, builds Apple
   Silicon DMG/ZIP artifacts, notarizes and staples the app, verifies Gatekeeper,
   emits a CycloneDX SBOM, signs the release manifest, and publishes a GitHub
   prerelease.
6. Do not manually upload or replace artifacts. A correction gets a new canary
   version and tag.

## Post-publish acceptance

Download the GitHub artifact on a clean Apple Silicon Mac rather than opening
the workflow copy. Confirm the manifest SHA-256 values and then exercise:

- first-run search/theme choice, Google navigation, tab restoration, private
  windows, history, bookmarks, download quarantine, password gesture, and PDF;
- Work open/close, model selection, workspace choice, one solo task, Stop,
  permission review, a browser tab grant/revoke, and agent crash recovery;
- ChatGPT Plan sign-in in the browser, dynamic model discovery, one completed
  plan-backed solo task, sign-out, and confirmation that ChatGPT API remains a
  separate usage-billed provider;
- signed extension install/update/rollback and a signed revocation disable;
- new passkey account, second-device approval, offline convergence, recovery-key
  rotation, device revocation, and cloud deletion;
- VoiceOver, keyboard-only use, Reduced Motion, and 200% text scaling.

Start with the internal cohort. Expand only after 24 hours without a critical
crash, data-loss report, high-severity security issue, or update failure.

## Rollback and incident response

- Stop rollout by marking the GitHub prerelease unavailable and removing it
  from the update feed. Never replace bytes under an existing version.
- Publish the last known-good canary as a new version when clients need an
  automatic rollback. Startup snapshots retain the two previous browser
  database versions for one-schema rollback.
- For an extension incident, sign and publish a revocation document first,
  set staged rollout to zero, then remove the package from discovery. Clients
  enforce the last verified revocation document even while offline.
- For a sync incident, preserve ciphertext and audit metadata, revoke affected
  device tokens, and avoid server-side transformations. The service cannot
  decrypt records.
- For a credential or signing-key incident, rotate the affected key and publish
  a new app build. Treat the release key, gallery key, Apple identity, and
  service secrets as separate trust domains.
- Record the incident timeline, affected versions, user impact, recovery steps,
  and follow-up tests before reopening rollout.

## Promotion gate

Canary promotion requires the automated workflow to remain green, Apple
notarization and clean-Mac acceptance to pass, and independent security,
accessibility, and sync-cryptography reviews to have no unresolved critical or
high findings. Beta and stable use new version numbers and separate approval;
the canary tag is never relabeled.
