begin;

create schema if not exists locus_sync;
revoke all on schema locus_sync from public;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'locus_sync_runtime') then
    create role locus_sync_runtime
      nologin
      noinherit
      nosuperuser
      nocreatedb
      nocreaterole
      noreplication
      connection limit 20;
  end if;
end
$$;

alter role locus_sync_runtime set search_path = pg_catalog;
alter role locus_sync_runtime set statement_timeout = '10s';
alter role locus_sync_runtime set lock_timeout = '3s';
alter role locus_sync_runtime set idle_in_transaction_session_timeout = '10s';

create table locus_sync.accounts (
  id text primary key,
  key_version integer not null default 0 check (key_version >= 0),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table locus_sync.devices (
  id text primary key,
  account_id text not null references locus_sync.accounts(id) on delete cascade,
  name text not null default 'Device' check (char_length(name) between 1 and 80),
  public_key text not null,
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  wrapped_account_key text,
  key_version integer not null default 0 check (key_version >= 0),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index devices_account_active on locus_sync.devices(account_id, last_seen_at desc) where revoked_at is null;

create sequence locus_sync.sync_cursor as bigint;
create table locus_sync.sync_records (
  account_id text not null references locus_sync.accounts(id) on delete cascade,
  collection text not null check (collection in ('bookmarks', 'history', 'tab-groups', 'remote-tabs', 'settings', 'extensions')),
  record_id text not null check (char_length(record_id) between 1 and 512),
  device_id text not null,
  clock text not null check (clock ~ '^\d{13}-\d{6}-[A-Za-z0-9_-]+$'),
  nonce text not null check (char_length(nonce) between 16 and 128),
  ciphertext text,
  object_key text,
  size integer not null check (size between 0 and 2097152),
  tombstone boolean not null default false,
  version smallint not null default 1 check (version = 1),
  cursor bigint not null default nextval('locus_sync.sync_cursor'::regclass),
  updated_at timestamptz not null default now(),
  primary key (account_id, collection, record_id),
  constraint sync_records_payload_location check (
    (ciphertext is not null and object_key is null)
    or (ciphertext is null and object_key is not null)
  ),
  constraint sync_records_object_key_shape check (
    object_key is null
    or object_key ~ '^v1/[a-f0-9]{32}/[a-f0-9]{40}/[a-f0-9]{64}$'
  )
);
create index sync_records_pull on locus_sync.sync_records(account_id, cursor);
create index sync_records_tombstone_expiry on locus_sync.sync_records(updated_at) where tombstone;

create table locus_sync.device_enrollments (
  id uuid primary key,
  account_id text references locus_sync.accounts(id) on delete cascade,
  device_id text not null,
  device_name text not null default 'Device' check (char_length(device_name) between 1 and 80),
  public_key text not null,
  code_hash text not null check (code_hash ~ '^[a-f0-9]{64}$'),
  wrapped_account_key text,
  device_token text,
  token_hash text,
  expires_at timestamptz not null,
  claimed_at timestamptz
);
create index device_enrollments_expiry on locus_sync.device_enrollments(expires_at);

create table locus_sync.passkeys (
  credential_id text primary key,
  account_id text not null references locus_sync.accounts(id) on delete cascade,
  user_id text not null,
  public_key text not null,
  counter bigint not null default 0 check (counter >= 0),
  device_type text not null,
  backed_up boolean not null default false,
  transports jsonb not null default '[]'::jsonb check (jsonb_typeof(transports) = 'array'),
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index passkeys_account on locus_sync.passkeys(account_id);

create table locus_sync.passkey_ceremonies (
  id uuid primary key,
  kind text not null check (kind in ('register', 'authenticate')),
  account_id text,
  user_id text,
  display_name text,
  challenge text not null,
  options_json jsonb not null check (jsonb_typeof(options_json) = 'object'),
  device_id text not null,
  device_name text not null default 'Device' check (char_length(device_name) between 1 and 80),
  device_public_key text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index passkey_ceremonies_expiry on locus_sync.passkey_ceremonies(expires_at);

create table locus_sync.passkey_claims (
  id uuid primary key,
  code_hash text not null check (code_hash ~ '^[a-f0-9]{64}$'),
  account_id text not null references locus_sync.accounts(id) on delete cascade,
  device_id text not null,
  device_token text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index passkey_claims_expiry on locus_sync.passkey_claims(expires_at);

alter table locus_sync.accounts enable row level security;
alter table locus_sync.devices enable row level security;
alter table locus_sync.sync_records enable row level security;
alter table locus_sync.device_enrollments enable row level security;
alter table locus_sync.passkeys enable row level security;
alter table locus_sync.passkey_ceremonies enable row level security;
alter table locus_sync.passkey_claims enable row level security;

create policy locus_sync_runtime_all on locus_sync.accounts for all to locus_sync_runtime using (true) with check (true);
create policy locus_sync_runtime_all on locus_sync.devices for all to locus_sync_runtime using (true) with check (true);
create policy locus_sync_runtime_all on locus_sync.sync_records for all to locus_sync_runtime using (true) with check (true);
create policy locus_sync_runtime_all on locus_sync.device_enrollments for all to locus_sync_runtime using (true) with check (true);
create policy locus_sync_runtime_all on locus_sync.passkeys for all to locus_sync_runtime using (true) with check (true);
create policy locus_sync_runtime_all on locus_sync.passkey_ceremonies for all to locus_sync_runtime using (true) with check (true);
create policy locus_sync_runtime_all on locus_sync.passkey_claims for all to locus_sync_runtime using (true) with check (true);

revoke all on all tables in schema locus_sync from public;
revoke all on all sequences in schema locus_sync from public;
grant usage on schema locus_sync to locus_sync_runtime;
grant select, insert, update, delete on all tables in schema locus_sync to locus_sync_runtime;
grant usage, select on all sequences in schema locus_sync to locus_sync_runtime;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all tables in schema locus_sync from anon';
    execute 'revoke all on all sequences in schema locus_sync from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on all tables in schema locus_sync from authenticated';
    execute 'revoke all on all sequences in schema locus_sync from authenticated';
  end if;
end
$$;

alter default privileges in schema locus_sync revoke all on tables from public;
alter default privileges in schema locus_sync revoke all on sequences from public;
alter default privileges in schema locus_sync grant select, insert, update, delete on tables to locus_sync_runtime;
alter default privileges in schema locus_sync grant usage, select on sequences to locus_sync_runtime;

comment on schema locus_sync is 'Private opaque Locus Browser sync metadata; never expose through PostgREST.';
comment on role locus_sync_runtime is 'Least-privilege login target for the Cloudflare Hyperdrive connection.';
comment on table locus_sync.sync_records is 'Client-encrypted records; large ciphertext bodies live in private Cloudflare R2.';

commit;
