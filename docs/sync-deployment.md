# Production encrypted-sync deployment

Production has one public component and two private stores:

```text
Locus Browser
    │ HTTPS, opaque encrypted records and device tokens
    ▼
Cloudflare Worker ── Hyperdrive ── Supabase Postgres / locus_sync
    │
    └── private R2 / large client-encrypted ciphertext
```

The Worker never receives an account key, recovery key, browser password,
cookie, workspace, or AI conversation. Supabase contains no public sync tables;
its Auth, Storage, Realtime, and Data API are not used by this service.

## Live canary deployment

The canary service is deployed at `https://sync.locushost.co`. Cloudflare is
authoritative for `locushost.co`; `workers.dev` and R2 public development URLs
are disabled. `locus-browser-sync-db` connects to the dedicated Supabase
project through the `locus_sync_runtime` role, and the production/preview R2
buckets remain private. Re-run the live gate at any time with:

```bash
LOCUS_SYNC_URL=https://sync.locushost.co pnpm sync:verify-deployment
```

## 1. Create the Supabase project

Use a dedicated Pro project so browser sync has its own backups, resource
limits, credentials, and failure boundary. Choose the region deliberately and
record it in the operations log. Do not add `locus_sync` to the project's
exposed API schemas.

Authenticate and link the CLI, then apply the reviewed migration:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
supabase db query --linked --file supabase/tests/locus_sync_permissions.sql
```

The migration creates a private `locus_sync` schema and a NOLOGIN
`locus_sync_runtime` role. Generate a unique 32+ character password in a secure
password manager, run the single `ALTER ROLE` statement from
`supabase/runtime-role.sql.example` as the Supabase `postgres` user, and store
the password only in the Hyperdrive configuration. Never place it in Wrangler
variables, GitHub, the desktop app, or a checked-in environment file.

Use Supabase's direct database endpoint, not Supavisor or the dedicated
transaction pooler. Hyperdrive provides the pool. Use TLS, the custom runtime
role, and the `postgres` database:

```text
postgresql://locus_sync_runtime:PASSWORD@db.PROJECT_REF.supabase.co:5432/postgres?sslmode=require
```

Keep daily backups enabled. Before canary promotion, restore a backup into a
separate project and run the permission query plus a two-device sync rehearsal.

## 2. Create Cloudflare storage and Hyperdrive

Connect Wrangler to the intended Cloudflare account. Create two private R2
buckets named `locus-browser-sync-production` and
`locus-browser-sync-preview`; do not enable an `r2.dev` hostname or public
bucket access.

Create `locus-browser-sync-db` in Hyperdrive using the direct Supabase
connection above. Disable SQL caching, require TLS, and set the soft origin
connection limit to 10. Cloudflare's `require` mode validates public WebPKI
certificates while encrypting the connection. Use `verify-full` only after
uploading Supabase's region-specific CA certificate to Cloudflare. Keep the
credential out of shell history and checked-in environment files.

Copy the returned Hyperdrive ID into `services/sync-worker/wrangler.jsonc`.
Replace both passkey hostname placeholders with the final sync hostname. The
deploy script refuses to upload while either placeholder remains.

## 3. Deploy the Worker

The Cloudflare account must have Workers Paid enabled. Attach the final custom
domain before any desktop release so passkey credentials are bound to a stable
RP ID.

```bash
pnpm --filter @locus/sync-worker build
pnpm --filter @locus/sync-worker run deploy
LOCUS_SYNC_URL=https://sync.locushost.co pnpm sync:verify-deployment
```

The Worker config enables Smart Placement, a 30-second CPU ceiling, public and
device rate-limit bindings, logs, a dependency-aware `/ready` endpoint, and a
daily R2 orphan reconciliation. The public limiter protects unauthenticated
passkey/enrollment routes; authenticated traffic is keyed by a SHA-256 digest
of the device token, never the raw token.

## 4. Canary acceptance

Use two clean browser profiles and verify registration, passkey sign-in,
account-key creation, device approval, offline convergence, a record larger
than 256 KB, recovery-key rotation, device revocation, cloud-data deletion, and
account deletion. Confirm the large record appears only as client-encrypted
ciphertext in R2 and that neither Worker nor Supabase logs contain request
bodies, authorization headers, claim codes, or credentials.

Create alerts for Worker exceptions and CPU exhaustion, `/ready` failures,
Hyperdrive origin errors, Supabase compute/storage/connection pressure, R2
operation spikes, and failed orphan reconciliation. Keep the Supabase spend cap
enabled and set Cloudflare usage notifications before inviting users.

## 5. Rotation and rollback

- Rotate the database password by changing the role password in Supabase and
  updating the Hyperdrive origin credential immediately afterward. Verify
  `/ready`, then invalidate the old credential.
- Roll back Worker code with Cloudflare deployment versions. Never point a
  rollback at a different database schema version.
- Database migrations must be additive through canary. Take a backup before
  each change and preserve one schema-version rollback.
- R2 is private operational storage, not the source of truth by itself. Do not
  bulk-delete objects outside the account-deletion API or the grace-period
  reconciler.
