begin;

alter table workspaces
  add column if not exists claimed_at timestamptz;

create table if not exists claim_tokens (
  id text primary key,
  workspace_id uuid not null references workspaces(id) on delete restrict,
  token_hash bytea not null,
  pepper_kid smallint not null,
  expires_at timestamptz not null,
  redeemed_at timestamptz,
  created_at timestamptz not null,
  constraint claim_tokens_id_format check (id ~ '^ct_[0-9A-HJKMNP-TV-Z]{26}$')
);

create index if not exists claim_tokens_workspace_idx on claim_tokens(workspace_id);

alter table claim_tokens enable row level security;
alter table claim_tokens force row level security;

drop policy if exists claim_tokens_tenant on claim_tokens;
create policy claim_tokens_tenant on claim_tokens
  using (workspace_id::text = current_setting('app.workspace_id', true))
  with check (workspace_id::text = current_setting('app.workspace_id', true));

drop policy if exists claim_tokens_platform on claim_tokens;
create policy claim_tokens_platform on claim_tokens
  using (current_setting('app.platform', true) = 'on')
  with check (current_setting('app.platform', true) = 'on');

commit;
