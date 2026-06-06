import type { SqlExecutor } from "@agent-paste/commands";

export type StripeWebhookEventClaim = { status: "claimed" } | { status: "processed" } | { status: "in_progress" };

export type ClaimStripeWebhookEventInput = {
  executor: SqlExecutor;
  eventId: string;
  eventType: string;
  subscriptionId: string;
  stripeCustomerId: string | null;
  workspaceId: string | null;
  now: string;
};

export async function claimStripeWebhookEvent(input: ClaimStripeWebhookEventInput): Promise<StripeWebhookEventClaim> {
  const inserted = await input.executor.query<{ event_id: string }>(
    `insert into stripe_webhook_events (
       event_id,
       event_type,
       stripe_subscription_id,
       stripe_customer_id,
       target_workspace_id,
       processing_started_at,
       created_at,
       updated_at
     )
     values ($1, $2, $3, $4, $5, $6, $6, $6)
     on conflict (event_id) do nothing
     returning event_id`,
    [input.eventId, input.eventType, input.subscriptionId, input.stripeCustomerId, input.workspaceId, input.now],
  );
  if (inserted.rows[0]) {
    return { status: "claimed" };
  }

  const existing = await input.executor.query<{ processed_at: string | null }>(
    `select processed_at from stripe_webhook_events where event_id = $1`,
    [input.eventId],
  );
  if (existing.rows[0]?.processed_at) {
    return { status: "processed" };
  }
  return { status: "in_progress" };
}

export async function markStripeWebhookEventProcessed(input: {
  executor: SqlExecutor;
  eventId: string;
  now: string;
}): Promise<void> {
  await input.executor.query(
    `update stripe_webhook_events
     set processed_at = $2,
         updated_at = $2
     where event_id = $1`,
    [input.eventId, input.now],
  );
}

export async function releaseStripeWebhookEventClaim(input: { executor: SqlExecutor; eventId: string }): Promise<void> {
  await input.executor.query(`delete from stripe_webhook_events where event_id = $1 and processed_at is null`, [
    input.eventId,
  ]);
}
