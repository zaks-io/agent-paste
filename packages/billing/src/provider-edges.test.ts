import { describe, expect, it, vi } from "vitest";
import { createStripeBillingProvider } from "./provider.js";

type RecordedCall = { url: string; init: RequestInit };

function callHeaders(call: RecordedCall): Headers {
  return new Headers(call.init.headers);
}

describe("StripeBillingProvider request contracts", () => {
  it("posts checkout sessions with auth, form content type, and required subscription fields", async () => {
    const calls: RecordedCall[] = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init: init ?? {} });
      return new Response(JSON.stringify({ url: "https://checkout.stripe.com/c/session_1" }), { status: 200 });
    });
    const provider = createStripeBillingProvider({ secretKey: "sk_edge", fetchImpl });

    await provider.createCheckoutSession({
      workspaceId: "ws-edge",
      priceId: "price_edge",
      successUrl: "https://app.test/success",
      cancelUrl: "https://app.test/cancel",
      idempotencyKey: "idem-edge",
    });

    const [call] = calls;
    expect(call?.url).toBe("https://api.stripe.com/v1/checkout/sessions");
    expect(call?.init.method).toBe("POST");
    expect(callHeaders(call as RecordedCall).get("authorization")).toBe("Bearer sk_edge");
    expect(callHeaders(call as RecordedCall).get("content-type")).toBe("application/x-www-form-urlencoded");
    expect(callHeaders(call as RecordedCall).get("idempotency-key")).toBe("idem-edge");
    const body = new URLSearchParams(String(call?.init.body));
    expect(body.get("mode")).toBe("subscription");
    expect(body.get("line_items[0][price]")).toBe("price_edge");
    expect(body.get("line_items[0][quantity]")).toBe("1");
    expect(body.get("metadata[workspace_id]")).toBe("ws-edge");
    expect(body.get("subscription_data[metadata][workspace_id]")).toBe("ws-edge");
  });

  it("fetches checkout sessions with the Stripe bearer token", async () => {
    const calls: RecordedCall[] = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init: init ?? {} });
      return new Response(JSON.stringify({ customer: "cus_edge", subscription: "sub_edge" }), { status: 200 });
    });
    const provider = createStripeBillingProvider({ secretKey: "sk_edge", fetchImpl });

    await provider.getCheckoutSession("cs_edge");

    expect(calls[0]?.url).toBe("https://api.stripe.com/v1/checkout/sessions/cs_edge?expand[]=subscription");
    expect(callHeaders(calls[0] as RecordedCall).get("authorization")).toBe("Bearer sk_edge");
  });

  it("posts portal sessions with required form fields", async () => {
    const calls: RecordedCall[] = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init: init ?? {} });
      return new Response(JSON.stringify({ url: "https://portal.stripe.com/p/session_1" }), { status: 200 });
    });
    const provider = createStripeBillingProvider({ secretKey: "sk_edge", fetchImpl });

    await provider.createPortalSession({ customerId: "cus_edge", returnUrl: "https://app.test/billing" });

    const [call] = calls;
    expect(call?.url).toBe("https://api.stripe.com/v1/billing_portal/sessions");
    expect(call?.init.method).toBe("POST");
    expect(callHeaders(call as RecordedCall).get("authorization")).toBe("Bearer sk_edge");
    expect(callHeaders(call as RecordedCall).get("content-type")).toBe("application/x-www-form-urlencoded");
    const body = new URLSearchParams(String(call?.init.body));
    expect(body.get("customer")).toBe("cus_edge");
    expect(body.get("return_url")).toBe("https://app.test/billing");
  });

  it("sends bearer auth on invoice and subscription fetches", async () => {
    const calls: RecordedCall[] = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init: init ?? {} });
      if (url.includes("/v1/invoices?")) {
        return new Response(JSON.stringify({ data: [], has_more: false }), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          id: "sub_edge",
          status: "active",
          customer: "cus_edge",
          metadata: { workspace_id: "ws-edge" },
          items: { data: [{ price: { recurring: { interval: "month" } } }] },
        }),
        { status: 200 },
      );
    });
    const provider = createStripeBillingProvider({ secretKey: "sk_edge", fetchImpl });

    await provider.listInvoices({ customerId: "cus_edge", limit: 9 });
    await expect(provider.getSubscription("sub_edge")).resolves.toMatchObject({ priceInterval: "month" });

    expect(calls[0]?.url).toBe("https://api.stripe.com/v1/invoices?customer=cus_edge&limit=9");
    expect(callHeaders(calls[0] as RecordedCall).get("authorization")).toBe("Bearer sk_edge");
    expect(calls[1]?.url).toBe("https://api.stripe.com/v1/subscriptions/sub_edge");
    expect(callHeaders(calls[1] as RecordedCall).get("authorization")).toBe("Bearer sk_edge");
  });

  it("requests reconciliation pages with auth, all statuses, and a hard page size", async () => {
    const calls: RecordedCall[] = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init: init ?? {} });
      return new Response(JSON.stringify({ data: [], has_more: false }), { status: 200 });
    });
    const provider = createStripeBillingProvider({ secretKey: "sk_edge", fetchImpl });

    await expect(provider.listReconciliationSubscriptions()).resolves.toEqual([]);

    expect(calls[0]?.url).toBe("https://api.stripe.com/v1/subscriptions?limit=100&status=all");
    expect(callHeaders(calls[0] as RecordedCall).get("authorization")).toBe("Bearer sk_edge");
  });

  it("throws on failed reconciliation list requests", async () => {
    const provider = createStripeBillingProvider({
      secretKey: "sk_edge",
      fetchImpl: vi.fn(async () => new Response("{}", { status: 503 })),
    });

    await expect(provider.listReconciliationSubscriptions()).rejects.toThrow("stripe_subscription_list_failed:503");
  });

  it("stops reconciliation pagination when Stripe returns an empty page", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ data: [], has_more: true }), { status: 200 }));
    const provider = createStripeBillingProvider({ secretKey: "sk_edge", fetchImpl });

    await expect(provider.listReconciliationSubscriptions()).resolves.toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
