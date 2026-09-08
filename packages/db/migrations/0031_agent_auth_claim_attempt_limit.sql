begin;

alter table agent_auth_registrations
  add column if not exists claim_attempt_failures smallint not null default 0,
  add column if not exists claim_attempt_actor_id text;

update agent_auth_registrations
set claim_attempt_actor_id = workspace_member_id
where registration_type = 'anonymous'
  and status = 'verified'
  and claim_attempt_actor_id is null;

alter table agent_auth_registrations
  drop constraint if exists agent_auth_registrations_claim_attempt_failures_check,
  add constraint agent_auth_registrations_claim_attempt_failures_check
    check (claim_attempt_failures between 0 and 5);

alter table agent_auth_registrations
  drop constraint if exists agent_auth_registrations_status_check,
  add constraint agent_auth_registrations_status_check
    check (status in (
      'verified',
      'pending_step_up',
      'anonymous_unclaimed',
      'anonymous_claim_pending',
      'anonymous_claiming',
      'revoked'
    ));

commit;
