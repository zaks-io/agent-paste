-- WorkOS auth.md user-claimed anonymous flow.
--
-- Adds anonymous registrations backed by ephemeral workspaces plus a browser
-- claim-attempt token separate from the agent-held claim token.

begin;

alter table agent_auth_registrations
  add column if not exists registration_type text not null default 'identity_assertion',
  add column if not exists claim_token_id text references claim_tokens(id) on delete restrict,
  add column if not exists claim_attempt_token_hash bytea,
  add column if not exists claim_attempt_expires_at timestamptz;

create index if not exists agent_auth_registrations_claim_attempt_idx
  on agent_auth_registrations (claim_attempt_token_hash);

create index if not exists agent_auth_registrations_claim_token_id_idx
  on agent_auth_registrations (claim_token_id);

alter table agent_auth_registrations
  drop constraint if exists agent_auth_registrations_type_check,
  add constraint agent_auth_registrations_type_check
    check (registration_type in ('identity_assertion', 'anonymous'));

alter table agent_auth_registrations
  drop constraint if exists agent_auth_registrations_status_check,
  add constraint agent_auth_registrations_status_check
    check (status in (
      'verified',
      'pending_step_up',
      'anonymous_unclaimed',
      'anonymous_claim_pending',
      'revoked'
    ));

alter table agent_auth_access_tokens
  alter column delegation_id drop not null;

commit;
