begin;

create table if not exists workspaces (
  id uuid primary key,
  name text not null,
  contact_email text,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists api_keys (
  id text primary key,
  workspace_id uuid not null references workspaces(id) on delete restrict,
  public_id text not null unique,
  name text not null,
  secret_hmac text not null,
  pepper_kid smallint not null,
  scopes jsonb not null default '["publish","read"]'::jsonb,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null
);

create table if not exists upload_sessions (
  id text primary key,
  workspace_id uuid not null references workspaces(id) on delete restrict,
  artifact_id text not null,
  revision_id text not null,
  status text not null check (status in ('pending', 'finalized', 'expired', 'failed')),
  title text not null,
  entrypoint text not null,
  artifact_expires_at timestamptz not null,
  file_count integer not null check (file_count > 0),
  size_bytes bigint not null check (size_bytes >= 0),
  created_by_api_key_id text not null references api_keys(id) on delete restrict,
  expires_at timestamptz not null,
  created_at timestamptz not null,
  finalized_at timestamptz
);

create table if not exists upload_session_files (
  workspace_id uuid not null references workspaces(id) on delete restrict,
  upload_session_id text not null references upload_sessions(id) on delete cascade,
  path text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  served_content_type text not null,
  r2_key text not null,
  uploaded_at timestamptz,
  put_url_expires_at timestamptz not null,
  primary key (upload_session_id, path)
);

create table if not exists artifacts (
  id text primary key,
  workspace_id uuid not null references workspaces(id) on delete restrict,
  revision_id text not null unique,
  status text not null check (status in ('active', 'deleted', 'expired')),
  title text not null,
  entrypoint text not null,
  file_count integer not null check (file_count > 0),
  size_bytes bigint not null check (size_bytes >= 0),
  expires_at timestamptz not null,
  created_by_api_key_id text not null references api_keys(id) on delete restrict,
  deleted_at timestamptz,
  delete_reason text check (delete_reason is null or delete_reason in ('expired', 'admin_delete')),
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists artifact_files (
  workspace_id uuid not null references workspaces(id) on delete restrict,
  artifact_id text not null references artifacts(id) on delete cascade,
  revision_id text not null,
  path text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  served_content_type text not null,
  r2_key text not null,
  uploaded_at timestamptz not null,
  primary key (artifact_id, path)
);

create table if not exists operation_events (
  id text primary key,
  workspace_id uuid references workspaces(id) on delete restrict,
  actor_type text not null check (actor_type in ('api_key', 'admin', 'system')),
  actor_id text,
  action text not null,
  target_type text not null check (target_type in ('workspace', 'api_key', 'upload_session', 'artifact', 'cleanup')),
  target_id text not null,
  details jsonb not null default '{}'::jsonb,
  request_id text,
  occurred_at timestamptz not null
);

create table if not exists idempotency_records (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  actor_type text not null check (actor_type in ('api_key', 'admin', 'system')),
  actor_id text not null,
  operation text not null,
  idempotency_key text not null,
  status text not null check (status in ('in_flight', 'completed', 'failed')),
  result_json jsonb,
  created_at timestamptz not null,
  completed_at timestamptz,
  primary key (workspace_id, actor_type, actor_id, operation, idempotency_key)
);

create index if not exists api_keys_active_workspace_idx on api_keys(workspace_id) where revoked_at is null;
create index if not exists artifacts_workspace_created_idx on artifacts(workspace_id, created_at desc);
create index if not exists artifacts_active_expiry_idx on artifacts(workspace_id, expires_at) where status = 'active';
create index if not exists upload_sessions_pending_expiry_idx on upload_sessions(workspace_id, expires_at) where status = 'pending';
create index if not exists operation_events_workspace_occurred_idx on operation_events(workspace_id, occurred_at desc);
create index if not exists idempotency_records_created_idx on idempotency_records(created_at);

do $$
begin
  alter table artifacts
    add constraint artifacts_delete_reason_check
    check (delete_reason is null or delete_reason in ('expired', 'admin_delete'));
exception
  when duplicate_object then null;
end $$;

-- MVP workspace isolation is enforced in repository queries. API-key
-- authentication has to find a key by public id before a workspace context is
-- known, so transaction-scoped RLS would lock out normal deploy traffic here.

commit;
