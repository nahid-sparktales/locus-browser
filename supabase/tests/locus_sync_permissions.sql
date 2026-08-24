begin;

do $$
declare
  insecure_roles integer;
  protected_tables integer;
  runtime_policies integer;
begin
  select count(*) into insecure_roles
  from pg_roles
  where rolname = 'locus_sync_runtime'
    and (rolsuper or rolcreaterole or rolcreatedb or rolreplication or rolbypassrls);
  if insecure_roles <> 0 then
    raise exception 'locus_sync_runtime has elevated database privileges';
  end if;

  if not has_schema_privilege('locus_sync_runtime', 'locus_sync', 'USAGE') then
    raise exception 'locus_sync_runtime cannot use the private schema';
  end if;

  if not has_table_privilege('locus_sync_runtime', 'locus_sync.sync_records', 'SELECT,INSERT,UPDATE,DELETE') then
    raise exception 'locus_sync_runtime is missing sync-record permissions';
  end if;

  select count(*) into protected_tables
  from pg_class
  join pg_namespace on pg_namespace.oid = pg_class.relnamespace
  where pg_namespace.nspname = 'locus_sync'
    and pg_class.relkind = 'r'
    and pg_class.relrowsecurity;
  if protected_tables <> 7 then
    raise exception 'expected 7 RLS-protected sync tables, found %', protected_tables;
  end if;

  select count(*) into runtime_policies
  from pg_policies
  where schemaname = 'locus_sync'
    and policyname = 'locus_sync_runtime_all'
    and 'locus_sync_runtime' = any(roles);
  if runtime_policies <> 7 then
    raise exception 'expected 7 runtime RLS policies, found %', runtime_policies;
  end if;

  if exists (
    select 1
    from information_schema.role_table_grants
    where table_schema = 'locus_sync'
      and grantee in ('anon', 'authenticated', 'PUBLIC')
  ) then
    raise exception 'a Data API role can access the private sync schema';
  end if;
end
$$;

set local role locus_sync_runtime;
insert into locus_sync.accounts(id, key_version) values ('permission-test-account', 0);
delete from locus_sync.accounts where id = 'permission-test-account';
reset role;

rollback;
