begin;

-- Admin operations (workspace creation, cleanup sweeps) need to claim
-- idempotency records before any workspace exists, so workspace_id has to be
-- nullable and unconstrained. The previous FK + PK + NOT NULL combo blocked
-- them. Drop the PK first because Postgres refuses to drop NOT NULL on a PK
-- column.
alter table idempotency_records
  drop constraint if exists idempotency_records_pkey;

alter table idempotency_records
  drop constraint if exists idempotency_records_workspace_id_fkey;

alter table idempotency_records
  alter column workspace_id drop not null;

-- Replace the dropped PK with a unique index that treats nulls as equal so
-- admin ops sharing the same (actor, operation, key) collide as intended.
create unique index if not exists idempotency_records_unique
  on idempotency_records (workspace_id, actor_type, actor_id, operation, idempotency_key)
  nulls not distinct;

commit;
