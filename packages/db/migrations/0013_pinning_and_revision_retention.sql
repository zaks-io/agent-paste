begin;

alter table artifacts
  add column if not exists pinned_at timestamptz;

alter table workspaces
  add column if not exists revision_retention_days integer;

alter table workspaces
  drop constraint if exists workspaces_revision_retention_days_check;

alter table workspaces
  add constraint workspaces_revision_retention_days_check
  check (revision_retention_days is null or revision_retention_days >= 1);

commit;
