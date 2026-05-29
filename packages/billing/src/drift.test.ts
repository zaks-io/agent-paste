import { describe, expect, it, vi } from "vitest";
import { detectBillingDrift, logBillingDrift } from "./drift.js";

describe("detectBillingDrift", () => {
  it("reports field-level mismatches", () => {
    const drift = detectBillingDrift({
      workspaceId: "ws-1",
      local: {
        plan: "pro",
        stripe_customer_id: "cus_a",
        stripe_subscription_id: "sub_a",
        subscription_status: "active",
        current_period_end: null,
        price_interval: "month",
      },
      remote: {
        plan: "free",
        stripe_customer_id: "cus_a",
        stripe_subscription_id: "sub_a",
        subscription_status: "canceled",
        current_period_end: "2026-06-01T00:00:00.000Z",
        price_interval: "month",
      },
    });
    expect(drift.map((entry) => entry.field)).toEqual(
      expect.arrayContaining(["plan", "subscription_status", "current_period_end"]),
    );
  });
});

describe("logBillingDrift", () => {
  it("emits structured drift events", () => {
    const log = vi.fn();
    logBillingDrift(log, [
      {
        workspace_id: "ws-1",
        field: "plan",
        local: "pro",
        remote: "free",
      },
    ]);
    expect(log).toHaveBeenCalledWith("billing.drift", {
      workspace_id: "ws-1",
      field: "plan",
      local: "pro",
      remote: "free",
    });
  });
});
