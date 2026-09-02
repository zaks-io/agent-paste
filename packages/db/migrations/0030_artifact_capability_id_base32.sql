begin;

alter table artifacts
  drop constraint if exists artifacts_capability_id_check;

alter table artifacts
  add constraint artifacts_capability_id_check
  check (capability_id is null or capability_id ~ '^(?:[a-f0-9]{32}|[0-9a-hj-kmnp-tv-z]{5}(?:-[0-9a-hj-kmnp-tv-z]{5}){3})$');

commit;
