begin;

-- Multi-revision artifact model (Phase 4). Revisions are first-class rows; artifact_files
-- are keyed by revision so multiple file trees can coexist on one artifact.

create table if not exists revisions (
  id text primary key,
  workspace_id uuid not null references workspaces(id) on delete restrict,
  artifact_id text not null references artifacts(id) on delete cascade,
  revision_number integer,
  status text not null check (status in ('draft', 'published', 'retained')),
  entrypoint text not null,
  render_mode text not null default 'html' check (render_mode in ('html', 'markdown', 'text', 'image', 'audio', 'video')),
  file_count integer not null check (file_count > 0),
  size_bytes bigint not null check (size_bytes >= 0),
  bundle_status text not null default 'disabled' check (bundle_status in ('pending', 'ready', 'failed', 'disabled')),
  bundle_status_updated_at timestamptz,
  bytes_purge_enqueued_at timestamptz,
  created_by_api_key_id text not null references api_keys(id) on delete restrict,
  created_at timestamptz not null,
  published_at timestamptz
);

-- Backfill published revisions from existing artifacts before relaxing artifact.revision_id.
-- Use dynamic SQL so re-applying 0009 after 0014 does not parse dropped artifact columns.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'artifacts'
      and column_name = 'created_by_api_key_id'
  )
  and exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'revisions'
      and column_name = 'created_by_api_key_id'
  ) then
    execute $sql$
      insert into revisions (
        id,
        workspace_id,
        artifact_id,
        revision_number,
        status,
        entrypoint,
        render_mode,
        file_count,
        size_bytes,
        created_by_api_key_id,
        created_at,
        published_at
      )
      select
        a.revision_id,
        a.workspace_id,
        a.id,
        1,
        'published',
        a.entrypoint,
        'html',
        a.file_count,
        a.size_bytes,
        a.created_by_api_key_id,
        a.created_at,
        a.created_at
      from artifacts a
      where a.revision_id is not null
        and not exists (
          select 1 from revisions r
          where r.id = a.revision_id
        )
    $sql$;
  end if;
end $$;

-- artifact_files must allow multiple revisions per artifact.
alter table artifact_files drop constraint if exists artifact_files_pkey;
alter table artifact_files add constraint artifact_files_pkey primary key (artifact_id, revision_id, path);

-- artifacts.revision_id is the published-revision pointer only (nullable until first publish).
alter table artifacts drop constraint if exists artifacts_revision_id_key;
alter table artifacts alter column revision_id drop not null;

alter table artifact_files drop constraint if exists artifact_files_revision_id_revisions_id_fk;
alter table artifact_files add constraint artifact_files_revision_id_revisions_id_fk
  foreign key (revision_id) references revisions(id) on delete cascade;

create index if not exists revisions_artifact_created_idx
  on revisions(artifact_id, created_at desc);
create unique index if not exists revisions_artifact_number_unique
  on revisions(artifact_id, revision_number)
  where revision_number is not null;
create unique index if not exists revisions_one_draft_per_artifact
  on revisions(artifact_id)
  where status = 'draft';

alter table revisions enable row level security;
alter table revisions force row level security;

drop policy if exists revisions_tenant on revisions;
create policy revisions_tenant on revisions
  using (workspace_id::text = current_setting('app.workspace_id', true))
  with check (workspace_id::text = current_setting('app.workspace_id', true));

drop policy if exists revisions_platform on revisions;
create policy revisions_platform on revisions
  using (current_setting('app.platform', true) = 'on')
  with check (current_setting('app.platform', true) = 'on');

create index if not exists revisions_workspace_idx on revisions(workspace_id);

commit;
