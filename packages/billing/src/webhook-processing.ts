import type { SqlExecutor } from "@agent-paste/commands";
import type { BillingProvider, BillingSubscriptionSnapshot } from "./provider.js";
import { applyBillingSnapshot, loadLocalBillingRowBySubscription } from "./sync.js";
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
    const currentSnapshot =
      (await input.provider.getSubscription(reference.subscriptionId)) ??
      (await failClosedSnapshotForMissingCurrentSubscription(input.platformExecutor, reference));
    if (currentSnapshot) {
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
