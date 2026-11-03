begin;

-- Preserve the historical failed state while adding guarded-session readiness.
alter table upload_sessions drop constraint if exists upload_sessions_status_check;
alter table upload_sessions add constraint upload_sessions_status_check
  check (status in ('pending', 'ready', 'finalized', 'expired', 'failed'));

-- upload_sessions
alter table upload_sessions
  add column if not exists commit_guard text null check (commit_guard in ('paths','snapshot')),
  add column if not exists commit_snapshot_prefix text null,
  add column if not exists commit_snapshot_sha256 text null check (commit_snapshot_sha256 ~ '^[a-f0-9]{64}$'),
  add column if not exists pin_on_commit boolean not null default false,
  add column if not exists sealed_at timestamptz null,
  add column if not exists next_batch_index integer not null default 1;
update upload_sessions set sealed_at = created_at where sealed_at is null and commit_guard is null; -- legacy sessions are sealed
-- ready = commit-mode finalize, awaiting publish; historical failed sessions remain valid.

-- upload_session_files
alter table upload_session_files
  add column if not exists content_format text not null default 'single' check (content_format in ('single','chunked-v1')),
  add column if not exists verified_at timestamptz null,
  add column if not exists expect_kind text null check (expect_kind in ('sha256','absent')),
  add column if not exists expect_sha256 text null,
  add column if not exists expect_size_bytes bigint null,
  add column if not exists batch_index integer not null default 0;

create table if not exists upload_session_chunks (
  workspace_id uuid not null references workspaces(id) on delete restrict,
  upload_session_id text not null,
  path text not null,
  chunk_index integer not null check (chunk_index >= 0),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  size_bytes bigint not null check (size_bytes > 0),
  uploaded_at timestamptz null,
  primary key (upload_session_id, path, chunk_index),
  foreign key (upload_session_id, path) references upload_session_files(upload_session_id, path) on delete cascade
);
create index if not exists upload_session_chunks_blob_idx on upload_session_chunks (workspace_id, sha256, size_bytes);

create table if not exists upload_session_deletions (
  workspace_id uuid not null references workspaces(id) on delete restrict,
  upload_session_id text not null references upload_sessions(id) on delete cascade,
  kind text not null check (kind in ('path','prefix')),
  path text not null,
  expect_sha256 text null,
  expect_size_bytes bigint null,
  expect_snapshot_sha256 text null,
  batch_index integer not null default 0,
  primary key (upload_session_id, kind, path)
);

-- content_blobs
alter table content_blobs
  add column if not exists content_format text not null default 'single' check (content_format in ('single','chunked-v1')),
  add column if not exists gc_state text not null default 'live' check (gc_state in ('live','deleting')),
  add column if not exists gc_marked_at timestamptz null,
  add column if not exists r2_cleanup_eligible boolean not null default false;
-- Existing rows stay protected; new rows opt in. Reapplying must never unprotect history.
alter table content_blobs alter column r2_cleanup_eligible set default true;

create table if not exists content_blob_chunks (
  workspace_id uuid not null,
  sha256 text not null,
  size_bytes bigint not null,
  chunk_index integer not null check (chunk_index >= 0),
  chunk_sha256 text not null check (chunk_sha256 ~ '^[a-f0-9]{64}$'),
  chunk_size_bytes bigint not null check (chunk_size_bytes > 0),
  primary key (workspace_id, sha256, size_bytes, chunk_index),
  foreign key (workspace_id, sha256, size_bytes) references content_blobs(workspace_id, sha256, size_bytes) on delete cascade
);
create index if not exists content_blob_chunks_chunk_idx on content_blob_chunks (workspace_id, chunk_sha256, chunk_size_bytes);

-- artifact_files / revisions / workspaces
alter table artifact_files add column if not exists content_format text not null default 'single'
  check (content_format in ('single','chunked-v1'));
create index if not exists artifact_files_legacy_bytes_idx on artifact_files (workspace_id) where storage_kind = 'revision';
alter table revisions
  add column if not exists file_map_sha256 text null check (file_map_sha256 ~ '^[a-f0-9]{64}$'),
  add column if not exists file_map_size_bytes integer null,
  drop constraint if exists revisions_file_map_pair_check,
  add constraint revisions_file_map_pair_check check ((file_map_sha256 is null) = (file_map_size_bytes is null));
create index if not exists revisions_file_map_idx on revisions (workspace_id, file_map_sha256) where file_map_sha256 is not null;
alter table workspaces add column if not exists storage_budget_bytes bigint null check (storage_budget_bytes > 0);

alter table upload_session_chunks enable row level security;
alter table upload_session_chunks force row level security;
drop policy if exists upload_session_chunks_tenant on upload_session_chunks;
create policy upload_session_chunks_tenant on upload_session_chunks
  using (workspace_id::text = current_setting('app.workspace_id', true))
  with check (workspace_id::text = current_setting('app.workspace_id', true));
drop policy if exists upload_session_chunks_platform on upload_session_chunks;
create policy upload_session_chunks_platform on upload_session_chunks
  using (current_setting('app.platform', true) = 'on')
  with check (current_setting('app.platform', true) = 'on');

alter table upload_session_deletions enable row level security;
alter table upload_session_deletions force row level security;
drop policy if exists upload_session_deletions_tenant on upload_session_deletions;
create policy upload_session_deletions_tenant on upload_session_deletions
  using (workspace_id::text = current_setting('app.workspace_id', true))
  with check (workspace_id::text = current_setting('app.workspace_id', true));
drop policy if exists upload_session_deletions_platform on upload_session_deletions;
create policy upload_session_deletions_platform on upload_session_deletions
  using (current_setting('app.platform', true) = 'on')
  with check (current_setting('app.platform', true) = 'on');

alter table content_blob_chunks enable row level security;
alter table content_blob_chunks force row level security;
drop policy if exists content_blob_chunks_tenant on content_blob_chunks;
create policy content_blob_chunks_tenant on content_blob_chunks
  using (workspace_id::text = current_setting('app.workspace_id', true))
  with check (workspace_id::text = current_setting('app.workspace_id', true));
drop policy if exists content_blob_chunks_platform on content_blob_chunks;
create policy content_blob_chunks_platform on content_blob_chunks
  using (current_setting('app.platform', true) = 'on')
  with check (current_setting('app.platform', true) = 'on');

commit;
