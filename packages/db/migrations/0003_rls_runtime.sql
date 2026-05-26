begin;

-- Every authenticated request sets either app.workspace_id (tenant scope) or
-- app.platform = 'on' (platform scope used for pre-auth lookups, admin sweeps,
-- and the public Agent View token resolve path). RLS is fail-closed: when
-- neither GUC is set the predicate is UNKNOWN and rows are filtered out.
-- See ADR 0044.
--
-- The migration runner has no journal, so every statement must be re-runnable.

alter table workspaces enable row level security;
alter table api_keys enable row level security;
alter table upload_sessions enable row level security;
alter table upload_session_files enable row level security;
alter table artifacts enable row level security;
alter table artifact_files enable row level security;
alter table operation_events enable row level security;
alter table idempotency_records enable row level security;

-- Apply RLS even to the table owner so misconfigured deployments (and tests
-- against pglite, which runs as the table-owning role) cannot accidentally
-- bypass the policy. The Hyperdrive runtime role is also NOBYPASSRLS below;
-- belt and braces.
alter table workspaces force row level security;
alter table api_keys force row level security;
alter table upload_sessions force row level security;
alter table upload_session_files force row level security;
alter table artifacts force row level security;
alter table artifact_files force row level security;
alter table operation_events force row level security;
alter table idempotency_records force row level security;

drop policy if exists workspaces_tenant on workspaces;
create policy workspaces_tenant on workspaces
  using (id::text = current_setting('app.workspace_id', true))
  with check (id::text = current_setting('app.workspace_id', true));

drop policy if exists workspaces_platform on workspaces;
create policy workspaces_platform on workspaces
  using (current_setting('app.platform', true) = 'on')
  with check (current_setting('app.platform', true) = 'on');

drop policy if exists api_keys_tenant on api_keys;
create policy api_keys_tenant on api_keys
  using (workspace_id::text = current_setting('app.workspace_id', true))
  with check (workspace_id::text = current_setting('app.workspace_id', true));

drop policy if exists api_keys_platform on api_keys;
create policy api_keys_platform on api_keys
  using (current_setting('app.platform', true) = 'on')
  with check (current_setting('app.platform', true) = 'on');

drop policy if exists upload_sessions_tenant on upload_sessions;
create policy upload_sessions_tenant on upload_sessions
  using (workspace_id::text = current_setting('app.workspace_id', true))
  with check (workspace_id::text = current_setting('app.workspace_id', true));

drop policy if exists upload_sessions_platform on upload_sessions;
create policy upload_sessions_platform on upload_sessions
  using (current_setting('app.platform', true) = 'on')
  with check (current_setting('app.platform', true) = 'on');

drop policy if exists upload_session_files_tenant on upload_session_files;
create policy upload_session_files_tenant on upload_session_files
  using (workspace_id::text = current_setting('app.workspace_id', true))
  with check (workspace_id::text = current_setting('app.workspace_id', true));

drop policy if exists upload_session_files_platform on upload_session_files;
create policy upload_session_files_platform on upload_session_files
  using (current_setting('app.platform', true) = 'on')
  with check (current_setting('app.platform', true) = 'on');

drop policy if exists artifacts_tenant on artifacts;
create policy artifacts_tenant on artifacts
  using (workspace_id::text = current_setting('app.workspace_id', true))
  with check (workspace_id::text = current_setting('app.workspace_id', true));

drop policy if exists artifacts_platform on artifacts;
create policy artifacts_platform on artifacts
  using (current_setting('app.platform', true) = 'on')
  with check (current_setting('app.platform', true) = 'on');

drop policy if exists artifact_files_tenant on artifact_files;
create policy artifact_files_tenant on artifact_files
  using (workspace_id::text = current_setting('app.workspace_id', true))
  with check (workspace_id::text = current_setting('app.workspace_id', true));

drop policy if exists artifact_files_platform on artifact_files;
create policy artifact_files_platform on artifact_files
  using (current_setting('app.platform', true) = 'on')
  with check (current_setting('app.platform', true) = 'on');

drop policy if exists operation_events_tenant on operation_events;
create policy operation_events_tenant on operation_events
  using (workspace_id::text = current_setting('app.workspace_id', true))
  with check (workspace_id::text = current_setting('app.workspace_id', true));

drop policy if exists operation_events_platform on operation_events;
create policy operation_events_platform on operation_events
  using (current_setting('app.platform', true) = 'on')
  with check (current_setting('app.platform', true) = 'on');

drop policy if exists idempotency_records_tenant on idempotency_records;
create policy idempotency_records_tenant on idempotency_records
  using (workspace_id::text = current_setting('app.workspace_id', true))
  with check (workspace_id::text = current_setting('app.workspace_id', true));

drop policy if exists idempotency_records_platform on idempotency_records;
create policy idempotency_records_platform on idempotency_records
  using (current_setting('app.platform', true) = 'on')
  with check (current_setting('app.platform', true) = 'on');

-- RLS predicates filter by workspace_id on every query. The base tables that
-- did not already have a workspace_id index would otherwise full-scan; add
-- them here so the policy USING clause uses an index lookup.
-- idempotency_records is covered by its composite primary key
-- (workspace_id, actor_type, actor_id, operation, idempotency_key).
create index if not exists upload_session_files_workspace_idx
  on upload_session_files(workspace_id);
create index if not exists artifact_files_workspace_idx
  on artifact_files(workspace_id);

-- The Hyperdrive runtime role must be NOBYPASSRLS. The migration role is
-- privileged (BYPASSRLS) and stays that way. When DATABASE_RUNTIME_ROLE is set,
-- strip BYPASSRLS from that role so misconfigured connections fail closed.
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
