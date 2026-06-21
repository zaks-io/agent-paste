-- Drop the MVP-era operation event target-type allowlist.
--
-- The current schema treats target_type as free text so new workflows can record
-- their own provenance targets. Production databases that started from
-- 0001_mvp_postgres.sql can still carry this old check constraint.

begin;

alter table operation_events
  drop constraint if exists operation_events_target_type_check;

commit;
