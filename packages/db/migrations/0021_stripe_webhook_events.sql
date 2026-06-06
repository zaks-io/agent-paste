begin;

create table if not exists stripe_webhook_events (
  event_id text primary key,
  event_type text not null,
  stripe_subscription_id text,
  stripe_customer_id text,
  target_workspace_id uuid,
  processing_started_at timestamptz not null,
  processed_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create index if not exists stripe_webhook_events_subscription_idx
  on stripe_webhook_events (stripe_subscription_id);

create index if not exists stripe_webhook_events_processed_idx
  on stripe_webhook_events (processed_at);

alter table stripe_webhook_events enable row level security;
alter table stripe_webhook_events force row level security;

drop policy if exists stripe_webhook_events_platform on stripe_webhook_events;
create policy stripe_webhook_events_platform on stripe_webhook_events
  using (current_setting('app.platform', true) = 'on')
  with check (current_setting('app.platform', true) = 'on');

commit;
