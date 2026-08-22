CREATE TABLE IF NOT EXISTS accounts (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS devices (
  id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  public_key text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS sync_cursor;
CREATE TABLE IF NOT EXISTS sync_records (
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  collection text NOT NULL,
  record_id text NOT NULL,
  device_id text NOT NULL,
  clock text NOT NULL,
  nonce text NOT NULL,
  ciphertext text NOT NULL,
  size integer NOT NULL CHECK (size <= 2097152),
  tombstone boolean NOT NULL DEFAULT false,
  cursor bigint NOT NULL DEFAULT nextval('sync_cursor'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, collection, record_id)
);
CREATE INDEX IF NOT EXISTS sync_records_pull ON sync_records(account_id, cursor);

CREATE TABLE IF NOT EXISTS device_enrollments (
  id uuid PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  device_id text NOT NULL,
  public_key text NOT NULL,
  code_hash text NOT NULL,
  wrapped_account_key text,
  device_token text,
  token_hash text,
  expires_at timestamptz NOT NULL,
  claimed_at timestamptz
);
