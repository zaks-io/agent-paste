import type { SqlExecutor } from "@agent-paste/commands";

export type StripeWebhookEventClaim =
  | { status: "claimed"; processingStartedAt: string }
  | { status: "processed" }
  | { status: "in_progress" };

export const STRIPE_WEBHOOK_EVENT_CLAIM_LEASE_MS = 5 * 60 * 1000;

export type ClaimStripeWebhookEventInput = {
  executor: SqlExecutor;
  eventId: string;
  now: string;
  leaseMs?: number;
};

export async function claimStripeWebhookEvent(input: ClaimStripeWebhookEventInput): Promise<StripeWebhookEventClaim> {
  const inserted = await input.executor.query<{ event_id: string }>(
    `insert into stripe_webhook_events (
       event_id,
       processing_started_at,
       created_at,
       updated_at
     )
     values ($1, $2, $2, $2)
     on conflict (event_id) do nothing
     returning event_id`,
    [input.eventId, input.now],
  );
  if (inserted.rows[0]) {
    return { status: "claimed", processingStartedAt: input.now };
  }

  const leaseMs = input.leaseMs ?? STRIPE_WEBHOOK_EVENT_CLAIM_LEASE_MS;
  const staleBefore = new Date(Date.parse(input.now) - leaseMs).toISOString();
  const reclaimed = await input.executor.query<{ event_id: string }>(
    `update stripe_webhook_events
     set processing_started_at = $2,
         updated_at = $2
     where event_id = $1
       and processed_at is null
       and processing_started_at <= $3
     returning event_id`,
    [input.eventId, input.now, staleBefore],
  );
  if (reclaimed.rows[0]) {
    return { status: "claimed", processingStartedAt: input.now };
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
  processingStartedAt: string;
  now: string;
}): Promise<void> {
  const updated = await input.executor.query<{ event_id: string }>(
    `update stripe_webhook_events
     set processed_at = $2,
         updated_at = $2
     where event_id = $1
       and processing_started_at = $3
     returning event_id`,
    [input.eventId, input.now, input.processingStartedAt],
  );
  if (!updated.rows[0]) {
    throw new Error(`stripe_webhook_event_claim_lost:${input.eventId}`);
  }
}

export async function releaseStripeWebhookEventClaim(input: {
  executor: SqlExecutor;
  eventId: string;
  processingStartedAt: string;
}): Promise<void> {
  await input.executor.query(
    `delete from stripe_webhook_events
     where event_id = $1
       and processed_at is null
       and processing_started_at = $2`,
    [input.eventId, input.processingStartedAt],
  );
}
