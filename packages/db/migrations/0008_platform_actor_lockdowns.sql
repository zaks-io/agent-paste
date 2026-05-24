begin;

-- The operator-only platform lockdown surface (ADR 0040/0046) writes audit and
-- idempotency rows under a new 'platform' actor. Widen both actor_type CHECKs.
-- The migration runner has no journal, so every statement must be re-runnable.

alter table operation_events
  drop constraint if exists operation_events_actor_type_check;

alter table operation_events
  add constraint operation_events_actor_type_check
  check (actor_type in ('api_key', 'member', 'admin', 'system', 'platform'));

alter table idempotency_records
  drop constraint if exists idempotency_records_actor_type_check;

alter table idempotency_records
  add constraint idempotency_records_actor_type_check
  check (actor_type in ('api_key', 'member', 'admin', 'system', 'platform'));

-- platform_lockdowns holds reversible operator takedowns keyed (scope, target_id).
-- A partial unique index enforces a single effective (un-lifted) row per target.
create table if not exists platform_lockdowns (
  id text primary key,
  scope text not null,
  target_id text not null,
  reason_code text not null,
  set_at timestamptz not null,
  set_by text not null,
  lifted_at timestamptz,
  lifted_by text,
  constraint platform_lockdowns_scope_check check (scope in ('workspace', 'artifact'))
);

create unique index if not exists platform_lockdowns_effective_unique
  on platform_lockdowns (scope, target_id)
  where lifted_at is null;

-- Only the platform scope (current_setting('app.platform') = 'on') may read or
-- write lockdowns. Mirror the migration 0003 fail-closed RLS pattern.
alter table platform_lockdowns enable row level security;
alter table platform_lockdowns force row level security;

drop policy if exists platform_lockdowns_platform on platform_lockdowns;
create policy platform_lockdowns_platform on platform_lockdowns
  using (current_setting('app.platform', true) = 'on')
  with check (current_setting('app.platform', true) = 'on');

commit;
