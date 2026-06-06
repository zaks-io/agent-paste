import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BillingProvider, BillingSubscriptionSnapshot } from "./provider.js";
import { createFakeBillingProvider } from "./provider.js";
import { applyBillingSnapshot, loadLocalBillingRow } from "./sync.js";
import { applyMigrations, executorForPglite, platformExecutor, workspaceExecutor } from "./test-helpers/pglite.js";
import type { StripeEvent } from "./webhook.js";
import { processStripeSubscriptionWebhook } from "./webhook-processing.js";

const workspaceId = "77777777-7777-7777-7777-777777777777";
const subscriptionId = "sub_webhook_current";
const customerId = "cus_webhook_current";

function snapshot(overrides: Partial<BillingSubscriptionSnapshot> = {}): BillingSubscriptionSnapshot {
  return {
    workspaceId,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscriptionId,
    status: "active",
    currentPeriodEnd: "2026-07-01T00:00:00.000Z",
    priceInterval: "month",
    ...overrides,
  };
}

function subscriptionEvent(
  eventId: string,
  metadata: Record<string, string> = { workspace_id: workspaceId },
): StripeEvent {
  return {
    id: eventId,
    type: "customer.subscription.updated",
    data: { object: { id: subscriptionId, customer: customerId, metadata } },
  };
}

describe("processStripeSubscriptionWebhook", () => {
  let client: PGlite;
  let baseExecutor: ReturnType<typeof executorForPglite>;

  beforeEach(async () => {
    client = new PGlite();
    await applyMigrations(client);
    baseExecutor = executorForPglite(client);
    await platformExecutor(baseExecutor).query(
      `insert into workspaces (id, name, contact_email, plan, created_at, updated_at)
       values ($1, 'webhook', 'webhook@example.com', 'free', now(), now())`,
      [workspaceId],
    );
  }, 90_000);

  afterEach(async () => {
    await client.close();
  });

  it("applies the current Stripe subscription instead of a stale event snapshot", async () => {
    const provider = createFakeBillingProvider();
    provider.setSubscription(snapshot());
    await applyBillingSnapshot({
      executor: workspaceExecutor(baseExecutor, workspaceId),
      actorId: "checkout_activation",
      workspaceId,
      snapshot: snapshot(),
      now: "2026-06-01T00:00:00.000Z",
    });

    provider.setSubscription(snapshot({ status: "canceled", currentPeriodEnd: null, priceInterval: null }));
    const result = await processStripeSubscriptionWebhook({
      platformExecutor: platformExecutor(baseExecutor),
      workspaceExecutor: (id) => workspaceExecutor(baseExecutor, id),
      provider,
      event: subscriptionEvent("evt_stale_active"),
      now: "2026-06-02T00:00:00.000Z",
    });

    expect(result).toEqual({ received: true, handled: "processed" });
    await expect(loadLocalBillingRow(workspaceExecutor(baseExecutor, workspaceId), workspaceId)).resolves.toMatchObject(
      {
        plan: "free",
        subscription_status: "canceled",
      },
    );
  });

  it("returns duplicate for an already processed event id without a second provider fetch", async () => {
    const fake = createFakeBillingProvider();
    fake.setSubscription(snapshot());
    let getSubscriptionCalls = 0;
    const provider: BillingProvider = {
      ...fake,
      async getSubscription(subscriptionId) {
        getSubscriptionCalls += 1;
        return fake.getSubscription(subscriptionId);
      },
    };

    const input = {
      platformExecutor: platformExecutor(baseExecutor),
      workspaceExecutor: (id: string) => workspaceExecutor(baseExecutor, id),
      provider,
      event: subscriptionEvent("evt_duplicate"),
      now: "2026-06-03T00:00:00.000Z",
    };
    await expect(processStripeSubscriptionWebhook(input)).resolves.toEqual({ received: true, handled: "processed" });
    fake.updateStatus(subscriptionId, "canceled");
    await expect(processStripeSubscriptionWebhook({ ...input, now: "2026-06-03T00:05:00.000Z" })).resolves.toEqual({
      received: true,
      handled: "duplicate",
    });

    expect(getSubscriptionCalls).toBe(1);
    await expect(loadLocalBillingRow(workspaceExecutor(baseExecutor, workspaceId), workspaceId)).resolves.toMatchObject(
      {
        plan: "pro",
        subscription_status: "active",
      },
    );
  });

  it("releases the event claim when the provider fails before a mutation", async () => {
    const provider: BillingProvider = {
      ...createFakeBillingProvider(),
      async getSubscription() {
        throw new Error("provider_down");
      },
    };
    await expect(
      processStripeSubscriptionWebhook({
        platformExecutor: platformExecutor(baseExecutor),
        workspaceExecutor: (id) => workspaceExecutor(baseExecutor, id),
        provider,
        event: subscriptionEvent("evt_provider_down"),
        now: "2026-06-04T00:00:00.000Z",
      }),
    ).rejects.toThrow("provider_down");

    const ledger = await platformExecutor(baseExecutor).query<{ processed_at: string | null }>(
      `select processed_at from stripe_webhook_events where event_id = $1`,
      ["evt_provider_down"],
    );
    expect(ledger.rows).toHaveLength(0);
    await expect(loadLocalBillingRow(workspaceExecutor(baseExecutor, workspaceId), workspaceId)).resolves.toMatchObject(
      {
        plan: "free",
        subscription_status: null,
      },
    );
  });

  it("keeps a fresh unprocessed event claim in progress", async () => {
    const now = "2026-06-04T00:00:00.000Z";
    await platformExecutor(baseExecutor).query(
      `insert into stripe_webhook_events (event_id, processing_started_at, created_at, updated_at)
       values ($1, $2, $2, $2)`,
      ["evt_fresh_claim", now],
    );

    await expect(
      processStripeSubscriptionWebhook({
        platformExecutor: platformExecutor(baseExecutor),
        workspaceExecutor: (id) => workspaceExecutor(baseExecutor, id),
        provider: createFakeBillingProvider(),
        event: subscriptionEvent("evt_fresh_claim"),
        now,
      }),
    ).rejects.toThrow("stripe_webhook_event_in_progress:evt_fresh_claim");
  });

  it("reclaims and processes a stale unprocessed event claim", async () => {
    const fake = createFakeBillingProvider();
    fake.setSubscription(snapshot());
    let getSubscriptionCalls = 0;
    const provider: BillingProvider = {
      ...fake,
      async getSubscription(subscriptionId) {
        getSubscriptionCalls += 1;
        return fake.getSubscription(subscriptionId);
      },
    };
    await platformExecutor(baseExecutor).query(
      `insert into stripe_webhook_events (event_id, processing_started_at, created_at, updated_at)
       values ($1, $2, $2, $2)`,
      ["evt_stale_claim", "2026-06-04T00:00:00.000Z"],
    );

    await expect(
      processStripeSubscriptionWebhook({
        platformExecutor: platformExecutor(baseExecutor),
        workspaceExecutor: (id) => workspaceExecutor(baseExecutor, id),
        provider,
        event: subscriptionEvent("evt_stale_claim"),
        now: "2026-06-04T00:06:00.000Z",
      }),
    ).resolves.toEqual({ received: true, handled: "processed" });

    expect(getSubscriptionCalls).toBe(1);
    const ledger = await platformExecutor(baseExecutor).query<{ processed_at: string | null }>(
      `select processed_at from stripe_webhook_events where event_id = $1`,
      ["evt_stale_claim"],
    );
    expect(ledger.rows[0]?.processed_at).not.toBeNull();
    await expect(loadLocalBillingRow(workspaceExecutor(baseExecutor, workspaceId), workspaceId)).resolves.toMatchObject(
      {
        plan: "pro",
        subscription_status: "active",
      },
    );
  });

  it("fails closed to free when the current subscription cannot be fetched", async () => {
    await applyBillingSnapshot({
      executor: workspaceExecutor(baseExecutor, workspaceId),
      actorId: "checkout_activation",
      workspaceId,
      snapshot: snapshot(),
      now: "2026-06-05T00:00:00.000Z",
    });
    const provider: BillingProvider = {
      ...createFakeBillingProvider(),
      async getSubscription() {
        return null;
      },
    };

    await expect(
      processStripeSubscriptionWebhook({
        platformExecutor: platformExecutor(baseExecutor),
        workspaceExecutor: (id) => workspaceExecutor(baseExecutor, id),
        provider,
        event: subscriptionEvent("evt_missing_current", {}),
        now: "2026-06-05T01:00:00.000Z",
      }),
    ).resolves.toEqual({ received: true, handled: "processed" });

    await expect(loadLocalBillingRow(workspaceExecutor(baseExecutor, workspaceId), workspaceId)).resolves.toMatchObject(
      {
        plan: "free",
        subscription_status: "canceled",
        current_period_end: null,
      },
    );
  });
});
