begin;

create table if not exists workspace_members (
  id text primary key,
  workspace_id uuid not null references workspaces(id) on delete restrict,
  workos_user_id text not null,
  email text not null,
  scopes jsonb not null default '["publish","read","admin"]'::jsonb,
  created_at timestamptz not null,
  last_seen_at timestamptz not null
);

alter table workspace_members
  drop constraint if exists workspace_members_workos_user_id_unique;

alter table workspace_members
  drop constraint if exists workspace_members_workos_user_id_key;

alter table workspace_members
  alter column scopes set default '["publish","read","admin"]'::jsonb;

create index if not exists workspace_members_workspace_idx
  on workspace_members(workspace_id);

create index if not exists workspace_members_workos_user_idx
  on workspace_members(workos_user_id);

create unique index if not exists workspace_members_workspace_workos_user_unique
  on workspace_members(workspace_id, workos_user_id);

alter table workspace_members enable row level security;
alter table workspace_members force row level security;

drop policy if exists workspace_members_tenant on workspace_members;
create policy workspace_members_tenant on workspace_members
  using (workspace_id::text = current_setting('app.workspace_id', true))
  with check (workspace_id::text = current_setting('app.workspace_id', true));

drop policy if exists workspace_members_platform on workspace_members;
create policy workspace_members_platform on workspace_members
  using (current_setting('app.platform', true) = 'on')
  with check (current_setting('app.platform', true) = 'on');

commit;
