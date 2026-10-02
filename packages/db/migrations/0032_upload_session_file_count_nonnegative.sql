-- A session counts uploaded files, not the final merged Artifact tree. ADR 0089
-- delete-only deltas have zero uploads; whole publishes and merged trees still
-- require at least one file through API/repository validation.
-- Re-run safe: the migration runner reapplies every file without a journal.
begin;

alter table upload_sessions
  drop constraint if exists upload_sessions_file_count_check,
  add constraint upload_sessions_file_count_check check (file_count >= 0);

commit;
