begin;

-- Access Links (ADR 0047): durable rows with no stored secret; URLs are minted on demand.
create table if not exists access_links (
  id text primary key,
  workspace_id uuid not null references workspaces(id) on delete restrict,
  artifact_id text not null references artifacts(id) on delete cascade,
  revision_id text references revisions(id) on delete cascade,
  public_id text not null,
  type text not null check (type in ('share', 'revision')),
  scopes_bitmask smallint not null check (scopes_bitmask between 0 and 65535),
  expires_at timestamptz,
  created_by_type text not null check (created_by_type in ('api_key', 'member')),
  created_by_id text not null,
  created_at timestamptz not null,
  revoked_at timestamptz,
  constraint access_links_public_id_format check (public_id ~ '^[0-9A-HJKMNP-TV-Z]{16}$'),
  constraint access_links_type_revision_check check (
    (type = 'share' and revision_id is null)
    or (type = 'revision' and revision_id is not null)
  )
);

create unique index if not exists access_links_public_id_unique on access_links(public_id);
create index if not exists access_links_artifact_created_idx
  on access_links(artifact_id, created_at desc);
create index if not exists access_links_workspace_idx on access_links(workspace_id);

alter table artifacts
  add column if not exists access_link_lockdown_at timestamptz;

alter table access_links enable row level security;
alter table access_links force row level security;

drop policy if exists access_links_tenant on access_links;
create policy access_links_tenant on access_links
  using (workspace_id::text = current_setting('app.workspace_id', true))
  with check (workspace_id::text = current_setting('app.workspace_id', true));

drop policy if exists access_links_platform on access_links;
create policy access_links_platform on access_links
  using (current_setting('app.platform', true) = 'on')
  with check (current_setting('app.platform', true) = 'on');

commit;
