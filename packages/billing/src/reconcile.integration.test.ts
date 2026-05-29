import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createFakeBillingProvider } from "./provider.js";
import { runBillingReconciliation } from "./reconcile.js";
import { applyBillingSnapshot } from "./sync.js";
import { applyMigrations, executorForPglite, platformExecutor, workspaceExecutor } from "./test-helpers/pglite.js";

const workspaceId = "11111111-1111-1111-1111-111111111111";
const subscriptionId = "sub_test_reconcile";
const customerId = "cus_test_reconcile";

describe("billing reconciliation (webhook-independent)", () => {
  let baseExecutor: ReturnType<typeof executorForPglite>;

  beforeAll(async () => {
    const client = new PGlite();
    await applyMigrations(client);
    baseExecutor = executorForPglite(client);
    await platformExecutor(baseExecutor).query(
      `insert into workspaces (id, name, contact_email, plan, created_at, updated_at)
       values ($1, 'billing', 'billing@example.com', 'free', now(), now())`,
      [workspaceId],
    );
  }, 90_000);

  it("converges canceled Stripe state after synchronous checkout activation", async () => {
    const provider = createFakeBillingProvider();
    const now = "2026-05-28T12:00:00.000Z";
    provider.setSubscription({
      workspaceId,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
      status: "active",
      currentPeriodEnd: "2026-06-28T12:00:00.000Z",
      priceInterval: "month",
    });

    const snapshot = await provider.getSubscription(subscriptionId);
    if (!snapshot) {
      throw new Error("expected_subscription_snapshot");
    }
    const activation = await applyBillingSnapshot({
      executor: workspaceExecutor(baseExecutor, workspaceId),
      actorId: "checkout_activation",
      workspaceId,
      snapshot,
      now,
    });
    expect(activation).toMatchObject({ applied: true, plan: "pro", plan_changed: true });

    provider.updateStatus(subscriptionId, "canceled");

    const driftLog = vi.fn();
    const reconcile = await runBillingReconciliation({
      executor: platformExecutor(baseExecutor),
      provider,
      now: "2026-05-28T18:00:00.000Z",
      log: driftLog,
    });
    expect(reconcile.synced).toBeGreaterThanOrEqual(1);
    expect(driftLog).toHaveBeenCalled();

    const row = await platformExecutor(baseExecutor).query<{ plan: string; subscription_status: string }>(
      `select w.plan, b.subscription_status
       from workspaces w
       inner join workspace_billing b on b.workspace_id = w.id
       where w.id = $1`,
      [workspaceId],
    );
    expect(row.rows[0]).toEqual({ plan: "free", subscription_status: "canceled" });
  });

  it("preserves operator plan overrides during reconciliation", async () => {
    const overrideWorkspaceId = "22222222-2222-2222-2222-222222222222";
    await platformExecutor(baseExecutor).query(
      `insert into workspaces (
         id, name, contact_email, plan, plan_operator_override_at, created_at, updated_at
       )
       values ($1, 'override', 'override@example.com', 'pro', now(), now(), now())`,
      [overrideWorkspaceId],
    );
    await platformExecutor(baseExecutor).query(
      `insert into workspace_billing (
         workspace_id,
         stripe_customer_id,
         stripe_subscription_id,
         subscription_status,
         synced_at,
         updated_at
       )
       values ($1, $2, $3, 'active', now(), now())`,
      [overrideWorkspaceId, "cus_override", "sub_override"],
    );

    const provider = createFakeBillingProvider();
    provider.setSubscription({
      workspaceId: overrideWorkspaceId,
      stripeCustomerId: "cus_override",
      stripeSubscriptionId: "sub_override",
      status: "canceled",
      currentPeriodEnd: null,
      priceInterval: null,
    });

    const result = await runBillingReconciliation({
      executor: platformExecutor(baseExecutor),
      provider,
      now: "2026-05-28T19:00:00.000Z",
    });
    expect(result.skipped_operator_override).toBeGreaterThanOrEqual(1);

    const row = await platformExecutor(baseExecutor).query<{ plan: string }>(
      `select plan from workspaces where id = $1`,
      [overrideWorkspaceId],
    );
    expect(row.rows[0]?.plan).toBe("pro");
  });
});
