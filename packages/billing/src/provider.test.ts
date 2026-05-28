import { describe, expect, it, vi } from "vitest";
import {
  createFakeBillingProvider,
  createNoopBillingProvider,
  createStripeBillingProvider,
} from "./provider.js";

describe("BillingProvider adapters", () => {
  it("noop provider returns empty results", async () => {
    const provider = createNoopBillingProvider();
    await expect(provider.getSubscription("sub_x")).resolves.toBeNull();
    await expect(provider.listReconciliationSubscriptions()).resolves.toEqual([]);
  });

  it("fake provider round-trips subscription state", async () => {
    const provider = createFakeBillingProvider();
    provider.setSubscription({
      workspaceId: "ws-1",
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: "sub_1",
      status: "active",
      currentPeriodEnd: null,
      priceInterval: "month",
    });
    provider.updateStatus("sub_1", "canceled");
    await expect(provider.getSubscription("sub_1")).resolves.toMatchObject({ status: "canceled" });
  });

  it("stripe provider maps subscriptions with workspace metadata", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("/subscriptions/sub_1")) {
        return new Response(
          JSON.stringify({
            id: "sub_1",
            status: "active",
            customer: "cus_1",
            current_period_end: 1_900_000_000,
            metadata: { workspace_id: "ws-1" },
            items: { data: [{ price: { recurring: { interval: "year" } } }] },
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ data: [], has_more: false }), { status: 200 });
    });
    const provider = createStripeBillingProvider({ secretKey: "sk_test", fetchImpl });
    await expect(provider.getSubscription("sub_1")).resolves.toMatchObject({
      workspaceId: "ws-1",
      status: "active",
      priceInterval: "year",
    });
  });
});
