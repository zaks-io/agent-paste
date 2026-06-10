import type { SqlExecutor } from "@agent-paste/commands";
import { describe, expect, it } from "vitest";
import { detectBillingDrift } from "./drift.js";
import { loadLocalBillingRow, loadLocalBillingRowBySubscription } from "./sync.js";

const PERIOD_END_ISO = "2026-06-28T12:00:00.000Z";

function executorReturning(currentPeriodEnd: string | Date | null): SqlExecutor {
  const row = {
    workspace_id: "ws-1",
    plan: "pro",
    plan_operator_override_at: null,
    stripe_customer_id: "cus_a",
    stripe_subscription_id: "sub_a",
    subscription_status: "active",
    current_period_end: currentPeriodEnd,
    price_interval: "month",
  };
  return {
    async query<Row>() {
      return { rows: [row as Row] };
    },
    async transaction<T>(run: (tx: SqlExecutor) => Promise<T>) {
      return run(this);
    },
  };
}

function driftAgainstRemote(local: Awaited<ReturnType<typeof loadLocalBillingRow>>, remotePeriodEnd: string | null) {
  if (!local) {
    throw new Error("expected local billing row");
  }
  return detectBillingDrift({
    workspaceId: local.workspace_id,
    local: {
      plan: local.plan,
      stripe_customer_id: local.stripe_customer_id,
      stripe_subscription_id: local.stripe_subscription_id,
      subscription_status: local.subscription_status,
      current_period_end: local.current_period_end,
      price_interval: local.price_interval,
    },
    remote: {
      plan: "pro",
      stripe_customer_id: "cus_a",
      stripe_subscription_id: "sub_a",
      subscription_status: "active",
      current_period_end: remotePeriodEnd,
      price_interval: "month",
    },
  });
}

describe("loadLocalBillingRow timestamptz normalization", () => {
  it("normalizes a driver Date object to the ISO string Stripe snapshots use", async () => {
    const local = await loadLocalBillingRow(executorReturning(new Date(PERIOD_END_ISO)), "ws-1");
    expect(local?.current_period_end).toBe(PERIOD_END_ISO);
    expect(driftAgainstRemote(local, PERIOD_END_ISO)).toEqual([]);
  });

  it("normalizes postgres-js text output to the ISO string Stripe snapshots use", async () => {
    const local = await loadLocalBillingRow(executorReturning("2026-06-28 12:00:00+00"), "ws-1");
    expect(local?.current_period_end).toBe(PERIOD_END_ISO);
    expect(driftAgainstRemote(local, PERIOD_END_ISO)).toEqual([]);
  });

  it("preserves a null current_period_end", async () => {
    const local = await loadLocalBillingRow(executorReturning(null), "ws-1");
    expect(local?.current_period_end).toBeNull();
    expect(driftAgainstRemote(local, null)).toEqual([]);
  });

  it("still reports drift when the instants actually differ", async () => {
    const local = await loadLocalBillingRow(executorReturning(new Date(PERIOD_END_ISO)), "ws-1");
    const drift = driftAgainstRemote(local, "2026-07-28T12:00:00.000Z");
    expect(drift).toEqual([
      {
        workspace_id: "ws-1",
        field: "current_period_end",
        local: PERIOD_END_ISO,
        remote: "2026-07-28T12:00:00.000Z",
      },
    ]);
  });

  it("normalizes through the subscription-id lookup too", async () => {
    const local = await loadLocalBillingRowBySubscription(executorReturning(new Date(PERIOD_END_ISO)), "sub_a");
    expect(local?.current_period_end).toBe(PERIOD_END_ISO);
  });
});
