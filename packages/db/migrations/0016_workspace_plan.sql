begin;

alter table workspaces
  add column if not exists plan text not null default 'free';

alter table workspaces
  drop constraint if exists workspaces_plan_check;

alter table workspaces
  add constraint workspaces_plan_check
  check (plan in ('free', 'pro'));

commit;
