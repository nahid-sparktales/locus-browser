CREATE TABLE IF NOT EXISTS accounts (
  id text PRIMARY KEY,
  key_version integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS devices (
  id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'Device',
  public_key text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  wrapped_account_key text,
  key_version integer NOT NULL DEFAULT 0,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
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
  version smallint NOT NULL DEFAULT 1 CHECK (version = 1),
  cursor bigint NOT NULL DEFAULT nextval('sync_cursor'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, collection, record_id)
);
CREATE INDEX IF NOT EXISTS sync_records_pull ON sync_records(account_id, cursor);

CREATE TABLE IF NOT EXISTS device_enrollments (
  id uuid PRIMARY KEY,
  account_id text REFERENCES accounts(id) ON DELETE CASCADE,
  device_id text NOT NULL,
  device_name text NOT NULL DEFAULT 'Device',
  public_key text NOT NULL,
  code_hash text NOT NULL,
  wrapped_account_key text,
  device_token text,
  token_hash text,
  expires_at timestamptz NOT NULL,
  claimed_at timestamptz
);
CREATE INDEX IF NOT EXISTS device_enrollments_expiry ON device_enrollments(expires_at);

CREATE TABLE IF NOT EXISTS passkeys (
  credential_id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  public_key text NOT NULL,
  counter bigint NOT NULL DEFAULT 0,
  device_type text NOT NULL,
  backed_up boolean NOT NULL DEFAULT false,
  transports jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
CREATE INDEX IF NOT EXISTS passkeys_account ON passkeys(account_id);

CREATE TABLE IF NOT EXISTS passkey_ceremonies (
  id uuid PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('register', 'authenticate')),
  account_id text,
  user_id text,
  display_name text,
  challenge text NOT NULL,
  options_json jsonb NOT NULL,
  device_id text NOT NULL,
  device_name text NOT NULL DEFAULT 'Device',
  device_public_key text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS passkey_ceremonies_expiry ON passkey_ceremonies(expires_at);

CREATE TABLE IF NOT EXISTS passkey_claims (
  id uuid PRIMARY KEY,
  code_hash text NOT NULL,
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  device_id text NOT NULL,
  device_token text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS passkey_claims_expiry ON passkey_claims(expires_at);

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS key_version integer NOT NULL DEFAULT 0;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS name text NOT NULL DEFAULT 'Device';
ALTER TABLE devices ADD COLUMN IF NOT EXISTS wrapped_account_key text;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS key_version integer NOT NULL DEFAULT 0;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE device_enrollments ALTER COLUMN account_id DROP NOT NULL;
ALTER TABLE device_enrollments ADD COLUMN IF NOT EXISTS device_name text NOT NULL DEFAULT 'Device';
ALTER TABLE passkey_ceremonies ADD COLUMN IF NOT EXISTS device_name text NOT NULL DEFAULT 'Device';
