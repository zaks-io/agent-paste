import { describe, expect, it, vi } from "vitest";
import { createFakeBillingProvider, createNoopBillingProvider, createStripeBillingProvider } from "./provider.js";

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

  it("stripe provider returns null for missing subscriptions", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 404 }));
    const provider = createStripeBillingProvider({ secretKey: "sk_test", fetchImpl });
    await expect(provider.getSubscription("sub_missing")).resolves.toBeNull();
  });

  it("stripe provider throws when subscription fetch fails", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 500 }));
    const provider = createStripeBillingProvider({ secretKey: "sk_test", fetchImpl });
    await expect(provider.getSubscription("sub_bad")).rejects.toThrow("stripe_subscription_fetch_failed:500");
  });

  it("stripe provider paginates reconciliation subscription lists", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (!url.includes("/subscriptions?")) {
        throw new Error(`unexpected_url:${url}`);
      }
      if (!url.includes("starting_after=sub_page1")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "sub_page1",
                status: "active",
                customer: { id: "cus_page1" },
                current_period_end: null,
                metadata: { workspace_id: "ws-page1" },
              },
            ],
            has_more: true,
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "sub_page2",
              status: "canceled",
              customer: "cus_page2",
              current_period_end: 1_900_000_000,
              metadata: { workspace_id: "ws-page2" },
              items: { data: [{ price: { recurring: { interval: "week" } } }] },
            },
          ],
          has_more: false,
        }),
        { status: 200 },
      );
    });
    const provider = createStripeBillingProvider({ secretKey: "sk_test", fetchImpl });
    await expect(provider.listReconciliationSubscriptions()).resolves.toEqual([
      expect.objectContaining({ workspaceId: "ws-page1", stripeSubscriptionId: "sub_page1" }),
      expect.objectContaining({
        workspaceId: "ws-page2",
        stripeSubscriptionId: "sub_page2",
        priceInterval: null,
      }),
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("stripe provider drops subscriptions without workspace metadata or unknown status", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: [
              {
                id: "sub_no_workspace",
                status: "active",
                customer: "cus_x",
                current_period_end: null,
              },
              {
                id: "sub_unknown_status",
                status: "weird_status",
                customer: "cus_y",
                current_period_end: null,
                metadata: { workspace_id: "ws-y" },
              },
            ],
            has_more: false,
          }),
          { status: 200 },
        ),
    );
    const provider = createStripeBillingProvider({ secretKey: "sk_test", fetchImpl });
    await expect(provider.listReconciliationSubscriptions()).resolves.toEqual([]);
  });
});
