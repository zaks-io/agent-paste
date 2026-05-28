begin;

alter table workspaces
  add column if not exists plan text not null default 'free';

alter table workspaces
  drop constraint if exists workspaces_plan_check;

alter table workspaces
  add constraint workspaces_plan_check
  check (plan in ('free', 'pro'));

alter table workspaces
  add column if not exists plan_operator_override_at timestamptz;

create table if not exists workspace_billing (
  workspace_id uuid primary key references workspaces (id) on delete cascade,
  stripe_customer_id text,
  stripe_subscription_id text,
  subscription_status text,
  current_period_end timestamptz,
  price_interval text,
  synced_at timestamptz not null,
  updated_at timestamptz not null,
  constraint workspace_billing_price_interval_check
    check (price_interval is null or price_interval in ('month', 'year')),
  constraint workspace_billing_subscription_status_check
    check (
      subscription_status is null
      or subscription_status in (
        'active',
        'trialing',
        'past_due',
        'canceled',
        'unpaid',
        'incomplete',
        'incomplete_expired',
        'paused'
      )
    )
);

create unique index if not exists workspace_billing_stripe_subscription_id_unique
  on workspace_billing (stripe_subscription_id)
  where stripe_subscription_id is not null;

create index if not exists workspace_billing_stripe_customer_idx
  on workspace_billing (stripe_customer_id)
  where stripe_customer_id is not null;

alter table workspace_billing enable row level security;
alter table workspace_billing force row level security;

drop policy if exists workspace_billing_tenant on workspace_billing;
create policy workspace_billing_tenant on workspace_billing
  using (workspace_id::text = current_setting('app.workspace_id', true))
  with check (workspace_id::text = current_setting('app.workspace_id', true));

drop policy if exists workspace_billing_platform on workspace_billing;
create policy workspace_billing_platform on workspace_billing
  using (current_setting('app.platform', true) = 'on')
  with check (current_setting('app.platform', true) = 'on');

commit;
