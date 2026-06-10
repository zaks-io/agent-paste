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
  it("keys on subscription state and the invocation instant", () => {
    expect(
      billingSyncIdempotencyKey({
        subscriptionId: "sub_123",
        status: "active",
        currentPeriodEnd: "2026-06-01T00:00:00.000Z",
        appliedAt: "2026-06-02T00:00:00.000Z",
      }),
    ).toBe("sync:sub_123:active:2026-06-01T00:00:00.000Z:2026-06-02T00:00:00.000Z");
  });

  it("yields distinct keys for distinct attempts at the same subscription state", () => {
    const base = {
      subscriptionId: "sub_123",
      status: "active" as const,
      currentPeriodEnd: "2026-06-01T00:00:00.000Z",
    };
    expect(billingSyncIdempotencyKey({ ...base, appliedAt: "2026-06-02T00:00:00.000Z" })).not.toBe(
      billingSyncIdempotencyKey({ ...base, appliedAt: "2026-06-03T00:00:00.000Z" }),
    );
  });
});
