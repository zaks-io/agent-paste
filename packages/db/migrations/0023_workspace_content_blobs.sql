begin;

create table if not exists content_blobs (
  workspace_id uuid not null references workspaces(id) on delete restrict,
  sha256 text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  r2_key text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (workspace_id, sha256, size_bytes),
  constraint content_blobs_sha256_check check (sha256 ~ '^[a-f0-9]{64}$')
);

create unique index if not exists content_blobs_r2_key_unique
  on content_blobs(r2_key);

alter table upload_session_files
  add column if not exists sha256 text,
  add column if not exists storage_kind text not null default 'revision';

alter table artifact_files
  add column if not exists sha256 text,
  add column if not exists storage_kind text not null default 'revision';

alter table upload_session_files
  drop constraint if exists upload_session_files_storage_kind_check,
  add constraint upload_session_files_storage_kind_check
    check (storage_kind in ('revision', 'blob'));

alter table upload_session_files
  drop constraint if exists upload_session_files_sha256_check,
  add constraint upload_session_files_sha256_check
    check (sha256 is null or sha256 ~ '^[a-f0-9]{64}$');

alter table artifact_files
  drop constraint if exists artifact_files_storage_kind_check,
  add constraint artifact_files_storage_kind_check
    check (storage_kind in ('revision', 'blob'));

alter table artifact_files
  drop constraint if exists artifact_files_sha256_check,
  add constraint artifact_files_sha256_check
    check (sha256 is null or sha256 ~ '^[a-f0-9]{64}$');

create index if not exists upload_session_files_blob_idx
  on upload_session_files(workspace_id, sha256, size_bytes);

create index if not exists artifact_files_blob_idx
  on artifact_files(workspace_id, sha256, size_bytes);

alter table content_blobs enable row level security;
alter table content_blobs force row level security;

drop policy if exists content_blobs_tenant on content_blobs;
create policy content_blobs_tenant on content_blobs
  using (workspace_id::text = current_setting('app.workspace_id', true))
  with check (workspace_id::text = current_setting('app.workspace_id', true));

drop policy if exists content_blobs_platform on content_blobs;
create policy content_blobs_platform on content_blobs
  using (current_setting('app.platform', true) = 'on')
  with check (current_setting('app.platform', true) = 'on');

commit;
