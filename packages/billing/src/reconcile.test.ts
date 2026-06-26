import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeBillingProvider, createNoopBillingProvider } from "./provider.js";
import { BILLING_RECONCILE_SWEEP_CAP, runBillingReconciliation } from "./reconcile.js";
import * as sync from "./sync.js";
import { localBillingRow, snapshot } from "./test-helpers/reconcile.js";
import { createTransactionalSqlExecutor } from "./test-helpers/sql-executor.js";

describe("runBillingReconciliation", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns zero work when there is no local billing state", async () => {
    const executor = createTransactionalSqlExecutor(async (sql) => {
      if (sql.includes("from workspace_billing")) {
        return { rows: [] };
      }
      return { rows: [] };
    });
    const result = await runBillingReconciliation({
      executor,
      provider: createNoopBillingProvider(),
      now: "2026-05-28T00:00:00.000Z",
    });
    expect(result).toEqual({
      discovered: 0,
      synced: 0,
      drift_events: 0,
      skipped_operator_override: 0,
      cap_hit: false,
    });
  });

  it("reports cap_hit when more local targets exist than the sweep cap", async () => {
    const targets = Array.from({ length: BILLING_RECONCILE_SWEEP_CAP + 1 }, (_, index) => ({
      workspace_id: `ws-${index}`,
      stripe_subscription_id: `sub-${index}`,
    }));
    const limits: unknown[] = [];
    const executor = createTransactionalSqlExecutor(async (sql, params) => {
      if (sql.includes("from workspace_billing") && sql.includes("stripe_subscription_id is not null")) {
        limits.push(params?.[0]);
        return { rows: targets };
      }
      return { rows: [] };
    });
    const result = await runBillingReconciliation({
      executor,
      provider: createNoopBillingProvider(),
      now: "2026-05-28T00:00:00.000Z",
      cap: BILLING_RECONCILE_SWEEP_CAP,
    });
    expect(result.cap_hit).toBe(true);
    expect(result.discovered).toBe(BILLING_RECONCILE_SWEEP_CAP);
    expect(limits).toEqual([BILLING_RECONCILE_SWEEP_CAP + 1]);
  });

  it("skips targets when Stripe has no subscription snapshot", async () => {
    const executor = createTransactionalSqlExecutor(async (sql) => {
      if (sql.includes("from workspace_billing") && sql.includes("stripe_subscription_id is not null")) {
        return { rows: [{ workspace_id: "ws-missing", stripe_subscription_id: "sub_missing" }] };
      }
      return { rows: [] };
    });
    const provider = createFakeBillingProvider();
    const result = await runBillingReconciliation({
      executor,
      provider,
      now: "2026-05-28T00:00:00.000Z",
    });
    expect(result).toMatchObject({ discovered: 1, synced: 0, drift_events: 0 });
  });

  it("fetches remote snapshots outside the list sweep via getSubscription", async () => {
    const remoteSnapshot = snapshot({
      workspaceId: "ws-fetch",
      stripeCustomerId: "cus_fetch",
      stripeSubscriptionId: "sub_fetch",
    });
    const getSubscription = vi.fn(async (subscriptionId: string) =>
      subscriptionId === "sub_fetch" ? remoteSnapshot : null,
    );
    const provider = {
      getSubscription,
      listReconciliationSubscriptions: vi.fn(async () => []),
    };

    vi.spyOn(sync, "loadLocalBillingRow").mockResolvedValue(
      localBillingRow({
        workspace_id: "ws-fetch",
        plan: "free",
        stripe_customer_id: "cus_fetch",
        stripe_subscription_id: "sub_fetch",
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

    const executor = createTransactionalSqlExecutor(async (sql) => {
      if (sql.includes("from workspace_billing") && sql.includes("stripe_subscription_id is not null")) {
        return { rows: [{ workspace_id: "ws-fetch", stripe_subscription_id: "sub_fetch" }] };
      }
      return { rows: [] };
    });

    const result = await runBillingReconciliation({
      executor,
      provider,
      now: "2026-05-28T00:00:00.000Z",
    });
    expect(getSubscription).toHaveBeenCalledWith("sub_fetch");
    expect(result.synced).toBe(1);
  });

  it("syncs remote-only workspaces that lack a local subscription id", async () => {
    const provider = createFakeBillingProvider();
    provider.setSubscription({
      workspaceId: "ws-remote-only",
      stripeCustomerId: "cus_remote",
      stripeSubscriptionId: "sub_remote",
      status: "active",
      currentPeriodEnd: null,
      priceInterval: "month",
    });

    vi.spyOn(sync, "loadLocalBillingRow").mockImplementation(async (_executor, workspaceId) => {
      if (workspaceId === "ws-remote-only") {
        return {
          workspace_id: "ws-remote-only",
          plan: "free",
          plan_operator_override_at: null,
          stripe_customer_id: null,
          stripe_subscription_id: null,
          subscription_status: null,
          current_period_end: null,
          price_interval: null,
        };
      }
      return null;
    });
    const applyBillingSnapshot = vi.spyOn(sync, "applyBillingSnapshot").mockResolvedValue({
      applied: true,
      replayed: false,
      skipped_operator_override: false,
      previous_plan: "free",
      plan: "pro",
      plan_changed: true,
    });

    const executor = createTransactionalSqlExecutor(async () => ({ rows: [] }));
    const result = await runBillingReconciliation({
      executor,
      provider,
      now: "2026-05-28T00:00:00.000Z",
    });
    expect(applyBillingSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "ws-remote-only", actorId: "billing_reconcile" }),
    );
    expect(result.synced).toBe(1);
  });

  it("uses a noop drift logger by default", async () => {
    const executor = createTransactionalSqlExecutor(async () => ({ rows: [] }));
    await expect(
      runBillingReconciliation({
        executor,
        provider: createNoopBillingProvider(),
        now: "2026-05-28T00:00:00.000Z",
      }),
    ).resolves.toBeDefined();
  });
});
