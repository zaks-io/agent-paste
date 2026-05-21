begin;

-- Admin operations (workspace creation, cleanup sweeps) need to claim
-- idempotency records before any workspace exists, so workspace_id has to be
-- nullable and unconstrained. The previous FK + NOT NULL combo blocked them.
alter table idempotency_records
  drop constraint if exists idempotency_records_workspace_id_fkey;

alter table idempotency_records
  alter column workspace_id drop not null;

-- The composite primary key already includes workspace_id, but Postgres treats
-- NULL as distinct in primary keys. Replace the PK with a unique index that
-- treats nulls as equal so admin ops sharing the same (actor, operation, key)
-- collide as intended.
alter table idempotency_records
  drop constraint if exists idempotency_records_pkey;

create unique index if not exists idempotency_records_unique
  on idempotency_records (workspace_id, actor_type, actor_id, operation, idempotency_key)
  nulls not distinct;

commit;
