begin;

alter table artifacts
  add column if not exists capability_id text;

update artifacts
set capability_id = replace(gen_random_uuid()::text, '-', '')
where revision_id is not null
  and capability_id is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'artifacts_capability_id_check'
  ) then
    alter table artifacts
      add constraint artifacts_capability_id_check
      check (capability_id is null or capability_id ~ '^[a-f0-9]{32}$');
  end if;
end $$;

create unique index if not exists artifacts_capability_id_unique
  on artifacts (capability_id);

commit;
