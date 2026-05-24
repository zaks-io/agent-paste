begin;

alter table workspaces
  add column if not exists auto_deletion_days integer not null default 30;

alter table workspaces
  drop constraint if exists workspaces_auto_deletion_days_check;

alter table workspaces
  add constraint workspaces_auto_deletion_days_check
  check (auto_deletion_days between 1 and 90);

commit;
