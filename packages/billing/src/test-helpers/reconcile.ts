import type { BillingSubscriptionSnapshot } from "../provider.js";
import type { LocalBillingRow } from "../sync.js";

export function snapshot(overrides: Partial<BillingSubscriptionSnapshot> = {}): BillingSubscriptionSnapshot {
  return {
    workspaceId: "ws-test",
    stripeCustomerId: "cus_test",
    stripeSubscriptionId: "sub_test",
    status: "active",
    currentPeriodEnd: null,
    priceInterval: "month",
    ...overrides,
  };
}

export function localBillingRow(overrides: Partial<LocalBillingRow> = {}): LocalBillingRow {
  return {
    workspace_id: "ws-test",
    plan: "free",
    plan_operator_override_at: null,
    stripe_customer_id: "cus_test",
    stripe_subscription_id: "sub_test",
    subscription_status: "active",
    current_period_end: null,
    price_interval: "month",
    ...overrides,
  };
}
