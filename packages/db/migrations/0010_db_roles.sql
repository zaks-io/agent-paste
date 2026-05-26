begin;

-- Application and migration database roles (ADR 0044, ADR 0058). The migration runner
-- has no journal, so every statement must be re-runnable.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_role') then
    create role app_role nosuperuser noinherit nobypassrls login;
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'platform_admin') then
    create role platform_admin nosuperuser noinherit bypassrls login;
  end if;
end $$;

-- Workers connect as app_role through Hyperdrive. platform_admin is for migrations only.

grant usage on schema public to app_role;
grant select, insert, update, delete on all tables in schema public to app_role;
alter default privileges in schema public
  grant select, insert, update, delete on tables to app_role;

grant usage, create on schema public to platform_admin;
grant all privileges on all tables in schema public to platform_admin;
grant all privileges on all sequences in schema public to platform_admin;
alter default privileges in schema public grant all on tables to platform_admin;
alter default privileges in schema public grant all on sequences to platform_admin;

-- Ensure the Hyperdrive runtime role cannot bypass RLS when DATABASE_RUNTIME_ROLE is set.
do $$
declare
  runtime_role text := current_setting('app.runtime_role', true);
begin
  if runtime_role is not null
    and runtime_role <> ''
    and exists (select 1 from pg_roles where rolname = runtime_role) then
    execute format('alter role %I nobypassrls', runtime_role);
  end if;
end $$;

commit;
