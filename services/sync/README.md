# Locus encrypted sync service

The service stores opaque client-encrypted records. It cannot decrypt their
contents. Run the local PostgreSQL/S3-compatible stack from the repository root:

```bash
docker compose -f compose.sync.yaml up --build
```

The checked-in bootstrap token is for local development only. Production must
replace bootstrap enrollment with the passkey authentication edge, use managed
secrets, TLS, a private database network, an object-store retention policy, and
backups. Records are capped at 2 MB and the batch body at 3 MB.

The service exposes:

- `POST /v1/sync/push`
- `GET /v1/sync/pull?cursor=`
- device enrollment, approval, one-time claim, and revocation
- `DELETE /v1/sync/cloud-data`
- `DELETE /v1/account`
