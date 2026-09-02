begin;

alter table artifacts
  drop constraint if exists artifacts_capability_id_check;

-- NOT VALID skips the full-table scan under the ACCESS EXCLUSIVE lock; new writes are checked immediately.
alter table artifacts
  add constraint artifacts_capability_id_check
  check (capability_id is null or capability_id ~ '^(?:[a-f0-9]{32}|[0-9a-hj-kmnp-tv-z]{5}(?:-[0-9a-hj-kmnp-tv-z]{5}){3})$')
  not valid;

commit;

-- Runs in its own transaction so the scan only holds SHARE UPDATE EXCLUSIVE.
alter table artifacts
  validate constraint artifacts_capability_id_check;
