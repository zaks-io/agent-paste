-- WorkOS auth.md agent verified flow.
--
-- Stores durable provider delegations, per-registration service assertions,
-- replay JTIs, and the short-lived API keys issued by /oauth2/token.
--
-- Migrations are applied in filename order with no journal, so every statement is
-- idempotent (re-run safe).

begin;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'workspace_members_workspace_id_id_unique'
  ) then
    alter table workspace_members
      add constraint workspace_members_workspace_id_id_unique unique (workspace_id, id);
  end if;
end $$;

create table if not exists agent_auth_delegations (
  id text primary key,
  workspace_id uuid not null references workspaces(id) on delete restrict,
  workspace_member_id text not null,
  provider_issuer text not null,
  provider_subject text not null,
  audience text not null,
  provider_client_id text not null,
  email text not null,
  created_at timestamptz not null,
  last_seen_at timestamptz not null,
  revoked_at timestamptz,
  constraint agent_auth_delegations_workspace_member_fk
    foreign key (workspace_id, workspace_member_id)
    references workspace_members(workspace_id, id)
    on delete restrict
);

alter table agent_auth_delegations
  drop constraint if exists agent_auth_delegations_workspace_member_id_fkey,
  drop constraint if exists agent_auth_delegations_workspace_member_id_workspace_members_id_fk;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'agent_auth_delegations_workspace_member_fk'
  ) then
    alter table agent_auth_delegations
      add constraint agent_auth_delegations_workspace_member_fk
      foreign key (workspace_id, workspace_member_id)
      references workspace_members(workspace_id, id)
      on delete restrict;
  end if;
end $$;

create index if not exists agent_auth_delegations_workspace_idx
  on agent_auth_delegations (workspace_id);

create index if not exists agent_auth_delegations_member_idx
  on agent_auth_delegations (workspace_member_id);

create unique index if not exists agent_auth_delegations_active_identity_unique
  on agent_auth_delegations (provider_issuer, provider_subject, audience)
  where revoked_at is null;

create table if not exists agent_auth_registrations (
  id text primary key,
  delegation_id text references agent_auth_delegations(id) on delete restrict,
  workspace_id uuid references workspaces(id) on delete restrict,
  workspace_member_id text,
  provider_issuer text not null,
  provider_subject text not null,
  audience text not null,
  provider_client_id text not null,
  email text not null,
  status text not null,
  claim_token_hash bytea,
  user_code_hash bytea,
  claim_expires_at timestamptz,
  completed_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint agent_auth_registrations_workspace_member_fk
    foreign key (workspace_id, workspace_member_id)
    references workspace_members(workspace_id, id)
    on delete restrict
);

alter table agent_auth_registrations
  drop constraint if exists agent_auth_registrations_workspace_member_id_fkey,
  drop constraint if exists agent_auth_registrations_workspace_member_id_workspace_members_id_fk;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'agent_auth_registrations_workspace_member_fk'
  ) then
    alter table agent_auth_registrations
      add constraint agent_auth_registrations_workspace_member_fk
      foreign key (workspace_id, workspace_member_id)
      references workspace_members(workspace_id, id)
      on delete restrict;
  end if;
end $$;

alter table agent_auth_registrations
  drop constraint if exists agent_auth_registrations_member_workspace_check,
  add constraint agent_auth_registrations_member_workspace_check
    check (workspace_member_id is null or workspace_id is not null);

create index if not exists agent_auth_registrations_delegation_idx
  on agent_auth_registrations (delegation_id);

create index if not exists agent_auth_registrations_claim_idx
  on agent_auth_registrations (claim_token_hash);

alter table agent_auth_registrations
  drop constraint if exists agent_auth_registrations_status_check,
  add constraint agent_auth_registrations_status_check
    check (status in ('verified', 'pending_step_up', 'revoked'));

create table if not exists agent_auth_jtis (
  provider_issuer text not null,
  jti text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null,
  primary key (provider_issuer, jti)
);

create index if not exists agent_auth_jtis_expires_idx
  on agent_auth_jtis (expires_at);

create table if not exists agent_auth_access_tokens (
  api_key_id text primary key references api_keys(id) on delete cascade,
  registration_id text not null references agent_auth_registrations(id) on delete restrict,
  delegation_id text not null references agent_auth_delegations(id) on delete restrict,
  issued_at timestamptz not null
);

create index if not exists agent_auth_access_tokens_delegation_idx
  on agent_auth_access_tokens (delegation_id);

alter table agent_auth_delegations enable row level security;
alter table agent_auth_registrations enable row level security;
alter table agent_auth_access_tokens enable row level security;
alter table agent_auth_jtis enable row level security;

alter table agent_auth_delegations force row level security;
alter table agent_auth_registrations force row level security;
alter table agent_auth_access_tokens force row level security;
alter table agent_auth_jtis force row level security;

drop policy if exists agent_auth_delegations_tenant on agent_auth_delegations;
create policy agent_auth_delegations_tenant on agent_auth_delegations
  using (workspace_id::text = current_setting('app.workspace_id', true))
  with check (workspace_id::text = current_setting('app.workspace_id', true));

drop policy if exists agent_auth_delegations_platform on agent_auth_delegations;
create policy agent_auth_delegations_platform on agent_auth_delegations
  using (current_setting('app.platform', true) = 'on')
  with check (current_setting('app.platform', true) = 'on');

drop policy if exists agent_auth_registrations_tenant on agent_auth_registrations;
create policy agent_auth_registrations_tenant on agent_auth_registrations
  using (workspace_id::text = current_setting('app.workspace_id', true))
  with check (workspace_id::text = current_setting('app.workspace_id', true));

drop policy if exists agent_auth_registrations_platform on agent_auth_registrations;
create policy agent_auth_registrations_platform on agent_auth_registrations
  using (current_setting('app.platform', true) = 'on')
  with check (current_setting('app.platform', true) = 'on');

drop policy if exists agent_auth_access_tokens_platform on agent_auth_access_tokens;
create policy agent_auth_access_tokens_platform on agent_auth_access_tokens
  using (current_setting('app.platform', true) = 'on')
  with check (current_setting('app.platform', true) = 'on');

drop policy if exists agent_auth_jtis_platform on agent_auth_jtis;
create policy agent_auth_jtis_platform on agent_auth_jtis
  using (current_setting('app.platform', true) = 'on')
  with check (current_setting('app.platform', true) = 'on');

commit;
