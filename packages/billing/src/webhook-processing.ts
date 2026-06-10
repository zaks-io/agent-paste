import type { SqlExecutor } from "@agent-paste/commands";
import { planFromSubscriptionStatus } from "./plan.js";
import type { BillingProvider, BillingSubscriptionSnapshot } from "./provider.js";
import { applyBillingSnapshot, loadLocalBillingRow, loadLocalBillingRowBySubscription } from "./sync.js";
import {
  type StripeEvent,
  type StripeSubscriptionEventReference,
  subscriptionReferenceFromStripeEvent,
} from "./webhook.js";
import {
  claimStripeWebhookEvent,
  markStripeWebhookEventProcessed,
  releaseStripeWebhookEventClaim,
} from "./webhook-ledger.js";

export class StripeWebhookEventInProgressError extends Error {
  constructor(eventId: string) {
    super(`stripe_webhook_event_in_progress:${eventId}`);
    this.name = "StripeWebhookEventInProgressError";
  }
}

export type ProcessStripeSubscriptionWebhookInput = {
  platformExecutor: SqlExecutor;
  workspaceExecutor: (workspaceId: string) => SqlExecutor;
  provider: BillingProvider;
  event: StripeEvent;
  now: string;
};

export type ProcessStripeSubscriptionWebhookResult = {
  received: true;
  handled: "ignored" | "duplicate" | "processed";
};

export async function processStripeSubscriptionWebhook(
  input: ProcessStripeSubscriptionWebhookInput,
): Promise<ProcessStripeSubscriptionWebhookResult> {
  const reference = subscriptionReferenceFromStripeEvent(input.event);
  if (!reference) {
    return { received: true, handled: "ignored" };
  }

  const claim = await claimStripeWebhookEvent({
    executor: input.platformExecutor,
    eventId: reference.eventId,
    now: input.now,
  });
  if (claim.status === "processed") {
    return { received: true, handled: "duplicate" };
  }
  if (claim.status === "in_progress") {
    throw new StripeWebhookEventInProgressError(reference.eventId);
  }

  try {
    const eventSnapshot =
      (await input.provider.getSubscription(reference.subscriptionId)) ??
      (await failClosedSnapshotForMissingCurrentSubscription(input.platformExecutor, reference));
    if (eventSnapshot) {
      const currentSnapshot = await resolveAuthoritativeSnapshot(input, eventSnapshot);
      await applyBillingSnapshot({
        executor: input.workspaceExecutor(currentSnapshot.workspaceId),
        actorId: "stripe_webhook",
        workspaceId: currentSnapshot.workspaceId,
        snapshot: currentSnapshot,
        now: input.now,
      });
    }
    await markStripeWebhookEventProcessed({
      executor: input.platformExecutor,
      eventId: reference.eventId,
      processingStartedAt: claim.processingStartedAt,
      now: input.now,
    });
    return { received: true, handled: "processed" };
  } catch (error) {
    if (error instanceof Error && error.message === "workspace_not_found") {
      await markStripeWebhookEventProcessed({
        executor: input.platformExecutor,
        eventId: reference.eventId,
        processingStartedAt: claim.processingStartedAt,
        now: input.now,
      });
      return { received: true, handled: "processed" };
    }
    await releaseStripeWebhookEventClaim({
      executor: input.platformExecutor,
      eventId: reference.eventId,
      processingStartedAt: claim.processingStartedAt,
    });
    throw error;
  }
}

/**
 * Cancel-at-period-end followed by re-subscribe creates a second Stripe subscription,
 * and events for the superseded one (notably its late `customer.subscription.deleted`)
 * keep arriving after the new one is active. While the workspace's stored subscription
 * still grants pro on Stripe, an event for a *different* subscription must not overwrite
 * it; apply a fresh snapshot of the stored subscription instead so the row converges on
 * current Stripe truth. The stored subscription must belong to the same workspace
 * (cross-tenant guard) before it can supersede the event.
 */
async function resolveAuthoritativeSnapshot(
  input: ProcessStripeSubscriptionWebhookInput,
  eventSnapshot: BillingSubscriptionSnapshot,
): Promise<BillingSubscriptionSnapshot> {
  const local = await loadLocalBillingRow(
    input.workspaceExecutor(eventSnapshot.workspaceId),
    eventSnapshot.workspaceId,
  );
  const storedSubscriptionId = local?.stripe_subscription_id;
  if (!storedSubscriptionId || storedSubscriptionId === eventSnapshot.stripeSubscriptionId) {
    return eventSnapshot;
  }
  const stored = await input.provider.getSubscription(storedSubscriptionId);
  if (
    stored &&
    stored.workspaceId === eventSnapshot.workspaceId &&
    planFromSubscriptionStatus(stored.status) === "pro"
  ) {
    return stored;
  }
  return eventSnapshot;
}

async function failClosedSnapshotForMissingCurrentSubscription(
  executor: SqlExecutor,
  reference: StripeSubscriptionEventReference,
): Promise<BillingSubscriptionSnapshot | null> {
  const local = await loadLocalBillingRowBySubscription(executor, reference.subscriptionId);
  const workspaceId = local?.workspace_id ?? reference.workspaceId;
  const stripeCustomerId = local?.stripe_customer_id ?? reference.stripeCustomerId;
  if (!workspaceId || !stripeCustomerId) {
    return null;
  }
  return {
    workspaceId,
    stripeCustomerId,
    stripeSubscriptionId: reference.subscriptionId,
    status: "canceled",
    currentPeriodEnd: null,
    priceInterval: null,
  };
}
