import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeBillingProvider, createNoopBillingProvider } from "./provider.js";
import { runBillingReconciliation } from "./reconcile.js";
import * as sync from "./sync.js";
import { localBillingRow, snapshot } from "./test-helpers/reconcile.js";
import { createTransactionalSqlExecutor } from "./test-helpers/sql-executor.js";

describe("runBillingReconciliation edge cases", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("does not report cap_hit when the sweep returns exactly the cap", async () => {
    const targets = Array.from({ length: 3 }, (_, index) => ({
      workspace_id: `ws-${index}`,
      stripe_subscription_id: `sub-${index}`,
    }));
    const executor = createTransactionalSqlExecutor(async (sql) => {
      if (sql.includes("from workspace_billing") && sql.includes("stripe_subscription_id is not null")) {
        return { rows: targets };
      }
      return { rows: [] };
    });
    const result = await runBillingReconciliation({
      executor,
      provider: createNoopBillingProvider(),
      now: "2026-05-28T00:00:00.000Z",
      cap: 3,
    });
    expect(result).toMatchObject({ discovered: 3, cap_hit: false });
  });

  it("reconciles a listed local subscription only once", async () => {
    const provider = createFakeBillingProvider();
    provider.setSubscription(snapshot({ workspaceId: "ws-listed", stripeSubscriptionId: "sub_listed" }));
    vi.spyOn(sync, "loadLocalBillingRow").mockResolvedValue(
      localBillingRow({ workspace_id: "ws-listed", stripe_subscription_id: "sub_listed" }),
    );
    const applyBillingSnapshot = vi.spyOn(sync, "applyBillingSnapshot").mockResolvedValue({
      applied: true,
      replayed: false,
      skipped_operator_override: false,
      previous_plan: "free",
      plan: "pro",
      plan_changed: true,
    });
    const executor = createTransactionalSqlExecutor(async (sql) => {
      if (sql.includes("from workspace_billing") && sql.includes("stripe_subscription_id is not null")) {
        return { rows: [{ workspace_id: "ws-listed", stripe_subscription_id: "sub_listed" }] };
      }
      return { rows: [] };
    });

    const result = await runBillingReconciliation({
      executor,
      provider,
      now: "2026-05-28T00:00:00.000Z",
    });
    expect(result.synced).toBe(1);
    expect(applyBillingSnapshot).toHaveBeenCalledTimes(1);
  });

  it("does not adopt a new remote subscription while the stored subscription is still pro", async () => {
    const provider = createFakeBillingProvider();
    provider.setSubscription(snapshot({ workspaceId: "ws-switch", stripeSubscriptionId: "sub_old", status: "active" }));
    provider.setSubscription(snapshot({ workspaceId: "ws-switch", stripeSubscriptionId: "sub_new", status: "active" }));
    vi.spyOn(sync, "loadLocalBillingRow").mockResolvedValue(
      localBillingRow({ workspace_id: "ws-switch", stripe_subscription_id: "sub_old" }),
    );
    const applyBillingSnapshot = vi.spyOn(sync, "applyBillingSnapshot").mockResolvedValue({
      applied: true,
      replayed: false,
      skipped_operator_override: false,
      previous_plan: "free",
      plan: "pro",
      plan_changed: true,
    });
    const executor = createTransactionalSqlExecutor(async (sql) => {
      if (sql.includes("from workspace_billing") && sql.includes("stripe_subscription_id is not null")) {
        return { rows: [{ workspace_id: "ws-switch", stripe_subscription_id: "sub_old" }] };
      }
      return { rows: [] };
    });

    await runBillingReconciliation({
      executor,
      provider,
      now: "2026-05-28T00:00:00.000Z",
    });
    expect(applyBillingSnapshot).toHaveBeenCalledTimes(1);
    expect(applyBillingSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ snapshot: expect.objectContaining({ stripeSubscriptionId: "sub_old" }) }),
    );
  });

  it("adopts a pro orphan when the stored subscription is no longer pro", async () => {
    const provider = createFakeBillingProvider();
    provider.setSubscription(
      snapshot({ workspaceId: "ws-switch", stripeSubscriptionId: "sub_old", status: "canceled" }),
    );
    provider.setSubscription(snapshot({ workspaceId: "ws-switch", stripeSubscriptionId: "sub_new", status: "active" }));
    vi.spyOn(sync, "loadLocalBillingRow").mockResolvedValue(
      localBillingRow({ workspace_id: "ws-switch", stripe_subscription_id: "sub_old" }),
    );
    const applyBillingSnapshot = vi.spyOn(sync, "applyBillingSnapshot").mockResolvedValue({
      applied: true,
      replayed: false,
      skipped_operator_override: false,
      previous_plan: "free",
      plan: "pro",
      plan_changed: true,
    });
    const executor = createTransactionalSqlExecutor(async (sql) => {
      if (sql.includes("from workspace_billing") && sql.includes("stripe_subscription_id is not null")) {
        return { rows: [{ workspace_id: "ws-switch", stripe_subscription_id: "sub_old" }] };
      }
      return { rows: [] };
    });

    const result = await runBillingReconciliation({
      executor,
      provider,
      now: "2026-05-28T00:00:00.000Z",
    });
    expect(result.synced).toBe(2);
    expect(applyBillingSnapshot).toHaveBeenLastCalledWith(
      expect.objectContaining({ snapshot: expect.objectContaining({ stripeSubscriptionId: "sub_new" }) }),
    );
  });

  it("skips operator-overridden local targets and replayed sync completions", async () => {
    const provider = createFakeBillingProvider();
    provider.setSubscription(snapshot({ workspaceId: "ws-override", stripeSubscriptionId: "sub_override" }));
    provider.setSubscription(snapshot({ workspaceId: "ws-replay", stripeSubscriptionId: "sub_replay" }));
    vi.spyOn(sync, "loadLocalBillingRow").mockImplementation(async (_executor, workspaceId) => {
      if (workspaceId === "ws-override") {
        return localBillingRow({
          workspace_id: "ws-override",
          stripe_subscription_id: "sub_override",
          plan_operator_override_at: "2026-05-28T00:00:00.000Z",
        });
      }
      return localBillingRow({ workspace_id: "ws-replay", stripe_subscription_id: "sub_replay" });
    });
    vi.spyOn(sync, "applyBillingSnapshot").mockResolvedValue({
      applied: true,
      replayed: true,
      skipped_operator_override: false,
      previous_plan: "free",
      plan: "pro",
      plan_changed: true,
    });
    const executor = createTransactionalSqlExecutor(async (sql) => {
      if (sql.includes("from workspace_billing") && sql.includes("stripe_subscription_id is not null")) {
        return {
          rows: [
            { workspace_id: "ws-override", stripe_subscription_id: "sub_override" },
            { workspace_id: "ws-replay", stripe_subscription_id: "sub_replay" },
          ],
        };
      }
      return { rows: [] };
    });

    const result = await runBillingReconciliation({
      executor,
      provider,
      now: "2026-05-28T00:00:00.000Z",
    });
    expect(result).toMatchObject({ skipped_operator_override: 1, synced: 0 });
  });

  it("logs each drift field before applying the remote snapshot", async () => {
    const provider = createFakeBillingProvider();
    provider.setSubscription(
      snapshot({
        workspaceId: "ws-drift",
        stripeCustomerId: "cus_remote",
        stripeSubscriptionId: "sub_drift",
        currentPeriodEnd: "2026-06-28T00:00:00.000Z",
        priceInterval: "year",
      }),
    );
    vi.spyOn(sync, "loadLocalBillingRow").mockResolvedValue(
      localBillingRow({
        workspace_id: "ws-drift",
        plan: "free",
        stripe_customer_id: "cus_local",
        stripe_subscription_id: "sub_drift",
        current_period_end: "2026-05-28T00:00:00.000Z",
        price_interval: "month",
      }),
    );
    vi.spyOn(sync, "applyBillingSnapshot").mockResolvedValue({
      applied: true,
      replayed: false,
      skipped_operator_override: false,
      previous_plan: "free",
      plan: "pro",
      plan_changed: true,
    });
    const log = vi.fn();
    const executor = createTransactionalSqlExecutor(async (sql) => {
      if (sql.includes("from workspace_billing") && sql.includes("stripe_subscription_id is not null")) {
        return { rows: [{ workspace_id: "ws-drift", stripe_subscription_id: "sub_drift" }] };
      }
      return { rows: [] };
    });

    const result = await runBillingReconciliation({
      executor,
      provider,
      now: "2026-05-28T00:00:00.000Z",
      log,
    });
    expect(result.drift_events).toBeGreaterThan(1);
    expect(log).toHaveBeenCalled();
  });
});
