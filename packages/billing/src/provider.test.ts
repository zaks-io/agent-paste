import { describe, expect, it, vi } from "vitest";
import { createFakeBillingProvider, createNoopBillingProvider, createStripeBillingProvider } from "./provider.js";

describe("BillingProvider adapters", () => {
  it("noop provider returns empty results", async () => {
    const provider = createNoopBillingProvider();
    await expect(provider.getSubscription("sub_x")).resolves.toBeNull();
    await expect(provider.listReconciliationSubscriptions()).resolves.toEqual([]);
    await expect(provider.getCheckoutSession("cs_x")).resolves.toBeNull();
    await expect(
      provider.createCheckoutSession({
        workspaceId: "ws-1",
        priceId: "price_1",
        successUrl: "https://app.test/ok",
        cancelUrl: "https://app.test/cancel",
        idempotencyKey: "idem-1",
      }),
    ).rejects.toThrow("billing_disabled");
    await expect(provider.createPortalSession({ customerId: "cus_1", returnUrl: "https://app.test" })).rejects.toThrow(
      "billing_disabled",
    );
    await expect(provider.listInvoices({ customerId: "cus_1" })).resolves.toEqual([]);
  });

  it("fake provider records invoice calls and returns seeded invoices", async () => {
    const provider = createFakeBillingProvider();
    await expect(provider.listInvoices({ customerId: "cus_unknown" })).resolves.toEqual([]);
    provider.setInvoices("cus_1", [
      {
        id: "in_1",
        created: "2026-05-12T00:00:00.000Z",
        amountDue: 1200,
        currency: "usd",
        status: "paid",
        description: "Pro · monthly",
        hostedInvoiceUrl: "https://invoice.stripe.com/i/in_1",
        invoicePdf: "https://invoice.stripe.com/i/in_1.pdf",
      },
    ]);
    const invoices = await provider.listInvoices({ customerId: "cus_1", limit: 5 });
    expect(invoices).toHaveLength(1);
    expect(invoices[0]).toMatchObject({ id: "in_1", amountDue: 1200 });
    expect(provider.invoiceCalls).toEqual([{ customerId: "cus_unknown" }, { customerId: "cus_1", limit: 5 }]);
  });

  it("stripe provider lists invoices for a customer and maps fields", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      calls.push(url);
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "in_1",
              created: 1_747_008_000,
              amount_due: 1200,
              currency: "usd",
              status: "paid",
              description: "Pro · monthly",
              hosted_invoice_url: "https://invoice.stripe.com/i/in_1",
              invoice_pdf: "https://invoice.stripe.com/i/in_1.pdf",
            },
            { id: "in_2" },
          ],
          has_more: false,
        }),
        { status: 200 },
      );
    });
    const provider = createStripeBillingProvider({ secretKey: "sk_test", fetchImpl });
    const invoices = await provider.listInvoices({ customerId: "cus_1", limit: 3 });
    expect(calls[0]).toBe("https://api.stripe.com/v1/invoices?customer=cus_1&limit=3");
    expect(invoices[0]).toEqual({
      id: "in_1",
      created: "2025-05-12T00:00:00.000Z",
      amountDue: 1200,
      currency: "usd",
      status: "paid",
      description: "Pro · monthly",
      hostedInvoiceUrl: "https://invoice.stripe.com/i/in_1",
      invoicePdf: "https://invoice.stripe.com/i/in_1.pdf",
    });
    // Defaults applied when Stripe omits optional fields.
    expect(invoices[1]).toMatchObject({ id: "in_2", created: null, amountDue: 0, currency: "usd", status: null });
  });

  it("stripe provider throws when the invoice list request fails", async () => {
    const provider = createStripeBillingProvider({
      secretKey: "sk_test",
      fetchImpl: vi.fn(async () => new Response("{}", { status: 500 })),
    });
    await expect(provider.listInvoices({ customerId: "cus_1" })).rejects.toThrow("stripe_invoice_list_failed:500");
  });

  it("fake provider records checkout and portal calls and returns deterministic urls", async () => {
    const provider = createFakeBillingProvider();
    const checkout = await provider.createCheckoutSession({
      workspaceId: "ws-1",
      priceId: "price_1",
      successUrl: "https://app.test/ok",
      cancelUrl: "https://app.test/cancel",
      idempotencyKey: "idem-1",
    });
    expect(checkout.url).toBe("https://stripe.test/checkout/ws-1");
    expect(provider.checkoutCalls).toHaveLength(1);
    expect(provider.checkoutCalls[0]).toMatchObject({ priceId: "price_1", idempotencyKey: "idem-1" });

    provider.setCheckoutSession("cs_1", { subscriptionId: "sub_1", customerId: "cus_1" });
    await expect(provider.getCheckoutSession("cs_1")).resolves.toMatchObject({ subscriptionId: "sub_1" });

    const portal = await provider.createPortalSession({ customerId: "cus_1", returnUrl: "https://app.test" });
    expect(portal.url).toBe("https://stripe.test/portal/cus_1");
    expect(provider.portalCalls).toHaveLength(1);
  });

  it("stripe provider posts a checkout session with workspace metadata and idempotency key", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init: init ?? {} });
      return new Response(JSON.stringify({ url: "https://checkout.stripe.com/c/session_1" }), { status: 200 });
    });
    const provider = createStripeBillingProvider({ secretKey: "sk_test", fetchImpl });
    const result = await provider.createCheckoutSession({
      workspaceId: "ws-1",
      customerId: "cus_1",
      priceId: "price_month",
      successUrl: "https://app.test/return?session_id={CHECKOUT_SESSION_ID}",
      cancelUrl: "https://app.test/cancel",
      idempotencyKey: "idem-checkout",
    });
    expect(result.url).toBe("https://checkout.stripe.com/c/session_1");
    const call = calls[0];
    expect(call?.url).toBe("https://api.stripe.com/v1/checkout/sessions");
    expect((call?.init.headers as Record<string, string>)["Idempotency-Key"]).toBe("idem-checkout");
    const body = String(call?.init.body);
    expect(body).toContain("metadata%5Bworkspace_id%5D=ws-1");
    expect(body).toContain("subscription_data%5Bmetadata%5D%5Bworkspace_id%5D=ws-1");
    expect(body).toContain("line_items%5B0%5D%5Bprice%5D=price_month");
    expect(body).toContain("customer=cus_1");
  });

  it("stripe provider expands the subscription when fetching a checkout session", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toContain("/v1/checkout/sessions/cs_1");
      expect(url).toContain("expand[]=subscription");
      return new Response(JSON.stringify({ customer: "cus_1", subscription: { id: "sub_1" } }), { status: 200 });
    });
    const provider = createStripeBillingProvider({ secretKey: "sk_test", fetchImpl });
    await expect(provider.getCheckoutSession("cs_1")).resolves.toEqual({
      subscriptionId: "sub_1",
      customerId: "cus_1",
    });
  });

  it("stripe provider returns null for a missing checkout session", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 404 }));
    const provider = createStripeBillingProvider({ secretKey: "sk_test", fetchImpl });
    await expect(provider.getCheckoutSession("cs_missing")).resolves.toBeNull();
  });

  it("stripe provider creates a portal session", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ url: "https://portal.stripe.com/p/1" }), { status: 200 }),
    );
    const provider = createStripeBillingProvider({ secretKey: "sk_test", fetchImpl });
    await expect(
      provider.createPortalSession({ customerId: "cus_1", returnUrl: "https://app.test/billing" }),
    ).resolves.toEqual({ url: "https://portal.stripe.com/p/1" });
  });

  it("stripe provider throws when checkout/portal requests fail or omit a url", async () => {
    const failing = createStripeBillingProvider({
      secretKey: "sk_test",
      fetchImpl: vi.fn(async () => new Response("{}", { status: 500 })),
    });
    await expect(
      failing.createCheckoutSession({
        workspaceId: "ws-1",
        priceId: "price_1",
        successUrl: "https://app.test/ok",
        cancelUrl: "https://app.test/cancel",
        idempotencyKey: "idem-1",
      }),
    ).rejects.toThrow("stripe_request_failed:/v1/checkout/sessions:500");

    const urlless = createStripeBillingProvider({
      secretKey: "sk_test",
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })),
    });
    await expect(urlless.createPortalSession({ customerId: "cus_1", returnUrl: "https://app.test" })).rejects.toThrow(
      "stripe_portal_session_missing_url",
    );
    await expect(
      urlless.createCheckoutSession({
        workspaceId: "ws-1",
        priceId: "price_1",
        successUrl: "https://app.test/ok",
        cancelUrl: "https://app.test/cancel",
        idempotencyKey: "idem-1",
      }),
    ).rejects.toThrow("stripe_checkout_session_missing_url");
  });

  it("stripe provider surfaces a failed checkout-session fetch and maps string ids", async () => {
    const failing = createStripeBillingProvider({
      secretKey: "sk_test",
      fetchImpl: vi.fn(async () => new Response("{}", { status: 500 })),
    });
    await expect(failing.getCheckoutSession("cs_x")).rejects.toThrow("stripe_checkout_session_fetch_failed:500");

    const stringIds = createStripeBillingProvider({
      secretKey: "sk_test",
      fetchImpl: vi.fn(
        async () => new Response(JSON.stringify({ customer: "cus_2", subscription: "sub_2" }), { status: 200 }),
      ),
    });
    await expect(stringIds.getCheckoutSession("cs_2")).resolves.toEqual({
      subscriptionId: "sub_2",
      customerId: "cus_2",
    });

    const nullIds = createStripeBillingProvider({
      secretKey: "sk_test",
      fetchImpl: vi.fn(
        async () => new Response(JSON.stringify({ customer: null, subscription: null }), { status: 200 }),
      ),
    });
    await expect(nullIds.getCheckoutSession("cs_3")).resolves.toEqual({ subscriptionId: null, customerId: null });
  });

  it("fake provider throws when updating an unknown subscription status", () => {
    const provider = createFakeBillingProvider();
    expect(() => provider.updateStatus("sub_missing", "canceled")).toThrow("unknown_subscription:sub_missing");
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

  it("stripe provider maps a null currentPeriodEnd when Stripe omits current_period_end", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            id: "sub_no_period",
            status: "active",
            customer: "cus_1",
            metadata: { workspace_id: "ws-1" },
          }),
          { status: 200 },
        ),
    );
    const provider = createStripeBillingProvider({ secretKey: "sk_test", fetchImpl });
    await expect(provider.getSubscription("sub_no_period")).resolves.toMatchObject({
      workspaceId: "ws-1",
      currentPeriodEnd: null,
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
