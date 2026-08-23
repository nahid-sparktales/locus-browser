# Locus encrypted sync service

The service stores opaque client-encrypted records. It cannot decrypt their
contents. Run the local PostgreSQL/S3-compatible stack from the repository root:

```bash
docker compose -f compose.sync.yaml up --build
```

The checked-in bootstrap token is for local development fixtures only. Account
creation and sign-in use hosted WebAuthn passkey ceremonies and expiring,
one-use claims. Production must use managed secrets, TLS, a private database
network, an object-store retention policy, and backups. Records are capped at
2 MB and the batch body at 3 MB.

Configure the passkey relying party explicitly in production:

```bash
LOCUS_PASSKEY_RP_NAME="Locus Sync"
LOCUS_PASSKEY_RP_ID="sync.example.com"
LOCUS_PASSKEY_ORIGIN="https://sync.example.com"
```

Non-HTTPS origins are rejected except for loopback development. The RP ID must
equal the configured origin hostname. The desktop accepts a non-HTTPS sync
service only on loopback as well.

The service exposes:

- `POST /v1/sync/push`
- `GET /v1/sync/pull?cursor=`
- passkey registration/authentication options, hosted ceremonies, and one-use
  claim exchange under `/v1/auth/passkeys`
- device listing plus enrollment creation, approval, one-time wrapped-key
  claim, self-cleanup, and remote-device revocation under `/v1/devices`
- account-key initialization, per-device wrapping, and transactional full-
  replica key rotation under `/v1/account/key`
- `DELETE /v1/sync/cloud-data`
- `DELETE /v1/account`

Every encrypted write carries the current account-key version. Rotation locks
the account, requires a complete replacement set of records and a wrapped key
for every active device, and advances that version atomically; stale writers
must fetch and unwrap the new device-specific key before retrying.

The service stores opaque ciphertext and routing metadata only. Passwords,
cookies, site storage, provider credentials, workspace data, Locus sessions,
and run records are not accepted by the desktop sync collector.
