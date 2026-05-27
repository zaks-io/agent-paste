begin;

alter table revisions
  add column if not exists bundle_size_bytes bigint check (bundle_size_bytes is null or bundle_size_bytes >= 0);

commit;
