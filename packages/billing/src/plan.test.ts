import { describe, expect, it } from "vitest";
import { billingSyncIdempotencyKey, planFromSubscriptionStatus } from "./plan.js";

describe("planFromSubscriptionStatus", () => {
  it("maps pro statuses", () => {
    expect(planFromSubscriptionStatus("active")).toBe("pro");
    expect(planFromSubscriptionStatus("trialing")).toBe("pro");
    expect(planFromSubscriptionStatus("past_due")).toBe("pro");
  });

  it("maps non-pro statuses to free", () => {
    expect(planFromSubscriptionStatus("canceled")).toBe("free");
    expect(planFromSubscriptionStatus("unpaid")).toBe("free");
    expect(planFromSubscriptionStatus(null)).toBe("free");
  });
});

describe("billingSyncIdempotencyKey", () => {
  it("keys on subscription state", () => {
    expect(
      billingSyncIdempotencyKey({
        subscriptionId: "sub_123",
        status: "active",
        currentPeriodEnd: "2026-06-01T00:00:00.000Z",
      }),
    ).toBe("sync:sub_123:active:2026-06-01T00:00:00.000Z");
  });
});
