-- A session counts uploads, not the final merged tree. Delete-only deltas have
-- zero uploads; API and finalize validation still require a nonempty final tree.
-- The runner reapplies all files. Keep an already-correct CHECK (and its OID)
-- so reruns avoid DDL/validation locks and interruption can resume safely.
begin;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'upload_sessions'::regclass
      and conname = 'upload_sessions_file_count_check'
      and contype = 'c'
      and pg_get_expr(conbin, conrelid) = '(file_count >= 0)'
  ) then
    alter table upload_sessions
      drop constraint if exists upload_sessions_file_count_check,
      add constraint upload_sessions_file_count_check
        check (file_count >= 0) not valid;
  end if;
end;
$$;

-- Release ACCESS EXCLUSIVE before scanning existing rows. NOT VALID already
-- enforces the new CHECK for writes; validation uses SHARE UPDATE EXCLUSIVE.
commit;

begin;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'upload_sessions'::regclass
      and conname = 'upload_sessions_file_count_check'
      and not convalidated
  ) then
    alter table upload_sessions
      validate constraint upload_sessions_file_count_check;
  end if;
end;
$$;

commit;
