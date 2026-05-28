begin;

-- Member-authenticated MCP publishes must not store workspace member ids in api_keys FK columns.

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'upload_sessions'
      and column_name = 'created_by_api_key_id'
  ) then
    alter table upload_sessions
      add column if not exists created_by_type text,
      add column if not exists created_by_id text;

    update upload_sessions
    set
      created_by_type = 'api_key',
      created_by_id = created_by_api_key_id
    where created_by_type is null;

    alter table upload_sessions
      drop constraint if exists upload_sessions_created_by_api_key_id_fkey;

    alter table upload_sessions
      drop constraint if exists upload_sessions_created_by_api_key_id_api_keys_id_fk;

    alter table upload_sessions
      drop column created_by_api_key_id;

    alter table upload_sessions
      alter column created_by_type set not null,
      alter column created_by_id set not null;

    alter table upload_sessions
      drop constraint if exists upload_sessions_created_by_type_check;

    alter table upload_sessions
      add constraint upload_sessions_created_by_type_check
      check (created_by_type in ('api_key', 'member'));
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'artifacts'
      and column_name = 'created_by_api_key_id'
  ) then
    alter table artifacts
      add column if not exists created_by_type text,
      add column if not exists created_by_id text;

    update artifacts
    set
      created_by_type = 'api_key',
      created_by_id = created_by_api_key_id
    where created_by_type is null;

    alter table artifacts
      drop constraint if exists artifacts_created_by_api_key_id_fkey;

    alter table artifacts
      drop constraint if exists artifacts_created_by_api_key_id_api_keys_id_fk;

    alter table artifacts
      drop column created_by_api_key_id;

    alter table artifacts
      alter column created_by_type set not null,
      alter column created_by_id set not null;

    alter table artifacts
      drop constraint if exists artifacts_created_by_type_check;

    alter table artifacts
      add constraint artifacts_created_by_type_check
      check (created_by_type in ('api_key', 'member'));
  end if;
end $$;

-- Legacy installs created revisions before 0009 used polymorphic creator columns.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'revisions'
      and column_name = 'created_by_api_key_id'
  ) then
    alter table revisions
      add column if not exists created_by_type text,
      add column if not exists created_by_id text;

    update revisions
    set
      created_by_type = 'api_key',
      created_by_id = created_by_api_key_id
    where created_by_type is null;

    alter table revisions
      drop constraint if exists revisions_created_by_api_key_id_fkey;

    alter table revisions
      drop constraint if exists revisions_created_by_api_key_id_api_keys_id_fk;

    alter table revisions
      drop column created_by_api_key_id;

    alter table revisions
      alter column created_by_type set not null,
      alter column created_by_id set not null;

    alter table revisions
      drop constraint if exists revisions_created_by_type_check;

    alter table revisions
      add constraint revisions_created_by_type_check
      check (created_by_type in ('api_key', 'member'));
  end if;
end $$;

commit;
