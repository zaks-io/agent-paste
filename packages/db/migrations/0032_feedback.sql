begin;

do $$ begin
  create type feedback_status as enum ('new', 'addressed');
exception when duplicate_object then null;
end $$;

create unique index if not exists api_keys_workspace_id_id_unique on api_keys(workspace_id, id);

create table if not exists feedback (
  id text primary key,
  workspace_id uuid not null references workspaces(id) on delete restrict,
  submitter_kind text not null,
  submitter_member_id text,
  submitter_api_key_id text,
  contact_email text,
  body text not null,
  context jsonb,
  status feedback_status not null default 'new',
  notification_suppressed boolean not null default false,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint feedback_member_fk foreign key (workspace_id, submitter_member_id) references workspace_members(workspace_id, id) on delete restrict,
  constraint feedback_api_key_fk foreign key (workspace_id, submitter_api_key_id) references api_keys(workspace_id, id) on delete restrict,
  constraint feedback_submitter_check check (
    (submitter_kind = 'member' and submitter_member_id is not null and submitter_api_key_id is null)
    or (submitter_kind = 'agent' and submitter_api_key_id is not null and submitter_member_id is null)
  ),
  constraint feedback_body_check check (char_length(btrim(body)) between 1 and 10000),
  constraint feedback_context_check check (context is null or (jsonb_typeof(context) = 'object' and octet_length(context::text) <= 16384))
);
create index if not exists feedback_workspace_created_idx on feedback(workspace_id, created_at, id);

alter table feedback enable row level security;
alter table feedback force row level security;
drop policy if exists feedback_tenant on feedback;
create policy feedback_tenant on feedback
  using (workspace_id::text = current_setting('app.workspace_id', true))
  with check (workspace_id::text = current_setting('app.workspace_id', true));
drop policy if exists feedback_platform on feedback;
create policy feedback_platform on feedback
  using (current_setting('app.platform', true) = 'on')
  with check (current_setting('app.platform', true) = 'on');

commit;
