import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import type { BillingSubscriptionSnapshot } from "./provider.js";
import { applyBillingSnapshot, loadLocalBillingRow } from "./sync.js";
import { applyMigrations, executorForPglite, platformExecutor, workspaceExecutor } from "./test-helpers/pglite.js";

const workspaceId = "33333333-3333-3333-3333-333333333333";
const subscriptionId = "sub_sync_test";
const customerId = "cus_sync_test";

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

describe("applyBillingSnapshot (webhook semantics)", () => {
  let baseExecutor: ReturnType<typeof executorForPglite>;

  beforeAll(async () => {
    const client = new PGlite();
    await applyMigrations(client);
    baseExecutor = executorForPglite(client);
    await platformExecutor(baseExecutor).query(
      `insert into workspaces (id, name, contact_email, plan, created_at, updated_at)
       values ($1, 'sync', 'sync@example.com', 'free', now(), now())`,
      [workspaceId],
    );
  }, 90_000);

  it("activates pro, replays identical retries, and converges on later re-applies", async () => {
    const executor = workspaceExecutor(baseExecutor, workspaceId);
    const first = await applyBillingSnapshot({
      executor,
      actorId: "stripe_webhook",
      workspaceId,
      snapshot: snapshot(),
      now: "2026-06-01T00:00:00.000Z",
    });
    expect(first).toMatchObject({ applied: true, replayed: false, plan: "pro", plan_changed: true });

    // An identical retry (same snapshot, same instant) replays the stored completion.
    const retry = await applyBillingSnapshot({
      executor,
      actorId: "stripe_webhook",
      workspaceId,
      snapshot: snapshot(),
      now: "2026-06-01T00:00:00.000Z",
    });
    expect(retry).toEqual({ ...first, replayed: true });

    // A later attempt at the same subscription state executes again and converges as a no-op.
    const reapply = await applyBillingSnapshot({
      executor,
      actorId: "stripe_webhook",
      workspaceId,
      snapshot: snapshot(),
      now: "2026-06-01T00:05:00.000Z",
    });
    expect(reapply).toMatchObject({ applied: true, replayed: false, plan: "pro", plan_changed: false });

    // Convergent re-apply emits no duplicate plan audit.
    const audit = await platformExecutor(baseExecutor).query<{ count: string }>(
      `select count(*)::text as count from operation_events
       where workspace_id = $1 and action = 'workspace.plan.updated'`,
      [workspaceId],
    );
    expect(audit.rows[0]?.count).toBe("1");

    const row = await loadLocalBillingRow(executor, workspaceId);
    expect(row).toMatchObject({ plan: "pro", subscription_status: "active" });
    // timestamptz round-trips as the same ISO instant Stripe snapshots carry,
    // regardless of how the driver represents the column.
    expect(row?.current_period_end).toBe("2026-07-01T00:00:00.000Z");
  });

  it("converges when a later canceled event arrives after activation", async () => {
    const executor = workspaceExecutor(baseExecutor, workspaceId);
    const canceled = await applyBillingSnapshot({
      executor,
      actorId: "stripe_webhook",
      workspaceId,
      snapshot: snapshot({ status: "canceled", currentPeriodEnd: null }),
      now: "2026-06-02T00:00:00.000Z",
    });
    expect(canceled).toMatchObject({ applied: true, plan: "free", plan_changed: true });

    const row = await loadLocalBillingRow(executor, workspaceId);
    expect(row).toMatchObject({ plan: "free", subscription_status: "canceled" });
  });

  it("converges an A→B→A status round-trip with an unchanged period end", async () => {
    const executor = workspaceExecutor(baseExecutor, workspaceId);
    // Same (subscription, status, period end) tuple as the first activation; only the
    // attempt instant differs. A cached completion must not strand the round-trip.
    const back = await applyBillingSnapshot({
      executor,
      actorId: "stripe_webhook",
      workspaceId,
      snapshot: snapshot(),
      now: "2026-06-03T00:00:00.000Z",
    });
    expect(back).toMatchObject({ applied: true, replayed: false, plan: "pro", plan_changed: true });

    const row = await loadLocalBillingRow(executor, workspaceId);
    expect(row).toMatchObject({
      plan: "pro",
      subscription_status: "active",
      stripe_subscription_id: subscriptionId,
    });
    expect(row?.current_period_end).toBe("2026-07-01T00:00:00.000Z");
  });

  it("skips the write when an operator override is set", async () => {
    const overrideWorkspaceId = "44444444-4444-4444-4444-444444444444";
    await platformExecutor(baseExecutor).query(
      `insert into workspaces (id, name, contact_email, plan, plan_operator_override_at, created_at, updated_at)
       values ($1, 'override', 'o@example.com', 'pro', now(), now(), now())`,
      [overrideWorkspaceId],
    );
    const result = await applyBillingSnapshot({
      executor: workspaceExecutor(baseExecutor, overrideWorkspaceId),
      actorId: "stripe_webhook",
      workspaceId: overrideWorkspaceId,
      snapshot: snapshot({ workspaceId: overrideWorkspaceId, status: "canceled" }),
      now: "2026-06-03T00:00:00.000Z",
    });
    expect(result).toMatchObject({ skipped_operator_override: true, plan: "pro" });
  });
});
