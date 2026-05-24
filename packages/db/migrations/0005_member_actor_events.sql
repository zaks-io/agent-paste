begin;

alter table operation_events
  drop constraint if exists operation_events_actor_type_check;

alter table operation_events
  add constraint operation_events_actor_type_check
  check (actor_type in ('api_key', 'member', 'admin', 'system'));

alter table idempotency_records
  drop constraint if exists idempotency_records_actor_type_check;

alter table idempotency_records
  add constraint idempotency_records_actor_type_check
  check (actor_type in ('api_key', 'member', 'admin', 'system'));

commit;
