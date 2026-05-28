begin;

create table if not exists safety_warnings (
  id text primary key,
  workspace_id uuid not null references workspaces(id) on delete restrict,
  artifact_id text not null,
  revision_id text not null,
  scanner_id text not null,
  scanner_version text not null,
  code text not null,
  severity text not null check (severity in ('info', 'warning')),
  scope text not null check (scope in ('artifact', 'revision', 'file')),
  file_path text,
  message text not null,
  created_at timestamptz not null,
  constraint safety_warnings_code_check check (code ~ '^[a-z0-9_]+$'),
  constraint safety_warnings_file_scope_check check (
    (scope = 'file' and file_path is not null)
    or (scope <> 'file' and file_path is null)
  ),
  constraint safety_warnings_revision_fk
    foreign key (workspace_id, artifact_id, revision_id)
    references revisions(workspace_id, artifact_id, id) on delete cascade
);

create index if not exists safety_warnings_revision_idx
  on safety_warnings(workspace_id, revision_id);
create index if not exists safety_warnings_scanner_idx
  on safety_warnings(workspace_id, revision_id, scanner_id);

alter table safety_warnings enable row level security;
alter table safety_warnings force row level security;

drop policy if exists safety_warnings_tenant on safety_warnings;
create policy safety_warnings_tenant on safety_warnings
  using (workspace_id::text = current_setting('app.workspace_id', true))
  with check (workspace_id::text = current_setting('app.workspace_id', true));

drop policy if exists safety_warnings_platform on safety_warnings;
create policy safety_warnings_platform on safety_warnings
  using (current_setting('app.platform', true) = 'on')
  with check (current_setting('app.platform', true) = 'on');

commit;
