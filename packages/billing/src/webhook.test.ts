import { describe, expect, it } from "vitest";
import { snapshotFromStripeEvent, verifyStripeSignature } from "./webhook.js";

const secret = "whsec_test_secret";

async function signedHeader(payload: string, timestamp: number, signingSecret = secret): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(signingSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${payload}`));
  const hex = [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `t=${timestamp},v1=${hex}`;
}

describe("verifyStripeSignature", () => {
  const now = 1_700_000_000;
  const payload = JSON.stringify({ id: "evt_1", type: "customer.subscription.updated" });

  it("accepts a valid signature within tolerance", async () => {
    const header = await signedHeader(payload, now);
    const result = await verifyStripeSignature({ payload, header, secret, now });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.event.id).toBe("evt_1");
    }
  });

  it("rejects a tampered payload", async () => {
    const header = await signedHeader(payload, now);
    const result = await verifyStripeSignature({ payload: `${payload} `, header, secret, now });
    expect(result).toMatchObject({ ok: false, reason: "signature_mismatch" });
  });

  it("rejects a wrong secret", async () => {
    const header = await signedHeader(payload, now, "whsec_other");
    const result = await verifyStripeSignature({ payload, header, secret, now });
    expect(result).toMatchObject({ ok: false, reason: "signature_mismatch" });
  });

  it("rejects a timestamp outside tolerance", async () => {
    const header = await signedHeader(payload, now - 10_000);
    const result = await verifyStripeSignature({ payload, header, secret, now });
    expect(result).toMatchObject({ ok: false, reason: "timestamp_out_of_tolerance" });
  });

  it("rejects a malformed header", async () => {
    const result = await verifyStripeSignature({ payload, header: "not-a-signature", secret, now });
    expect(result).toMatchObject({ ok: false, reason: "malformed_header" });
  });

  it("rejects a missing header", async () => {
    const result = await verifyStripeSignature({ payload, header: null, secret, now });
    expect(result).toMatchObject({ ok: false, reason: "malformed_header" });
  });

  it("rejects a header with a timestamp but no v1 signature", async () => {
    const result = await verifyStripeSignature({ payload, header: `t=${now}`, secret, now });
    expect(result).toMatchObject({ ok: false, reason: "no_signature" });
  });
});

describe("snapshotFromStripeEvent", () => {
  it("maps a subscription event with workspace metadata", () => {
    const snapshot = snapshotFromStripeEvent({
      id: "evt_1",
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_1",
          status: "active",
          customer: "cus_1",
          current_period_end: 1_900_000_000,
          metadata: { workspace_id: "ws-1" },
          items: { data: [{ price: { recurring: { interval: "year" } } }] },
        },
      },
    });
    expect(snapshot).toMatchObject({
      workspaceId: "ws-1",
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: "sub_1",
      status: "active",
      priceInterval: "year",
      // No item-level period end here, so the legacy top-level field is the fallback.
      currentPeriodEnd: new Date(1_900_000_000 * 1000).toISOString(),
    });
  });

  it("reads the item-level current_period_end (Stripe API 2025-03-31+)", () => {
    const itemPeriodEnd = 1_950_000_000;
    const snapshot = snapshotFromStripeEvent({
      id: "evt_item_period",
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_item",
          status: "active",
          customer: "cus_1",
          metadata: { workspace_id: "ws-1" },
          // The subscription no longer carries current_period_end; only the item does.
          items: { data: [{ current_period_end: itemPeriodEnd, price: { recurring: { interval: "month" } } }] },
        },
      },
    });
    expect(snapshot).toMatchObject({
      currentPeriodEnd: new Date(itemPeriodEnd * 1000).toISOString(),
      priceInterval: "month",
    });
  });

  it("returns null for irrelevant event types", () => {
    expect(snapshotFromStripeEvent({ id: "evt_2", type: "invoice.paid", data: { object: { id: "in_1" } } })).toBeNull();
  });

  it("returns null when workspace metadata is missing", () => {
    expect(
      snapshotFromStripeEvent({
        id: "evt_3",
        type: "customer.subscription.created",
        data: { object: { id: "sub_2", status: "active", customer: "cus_2" } },
      }),
    ).toBeNull();
  });

  it("returns null for an unknown status", () => {
    expect(
      snapshotFromStripeEvent({
        id: "evt_4",
        type: "customer.subscription.updated",
        data: { object: { id: "sub_3", status: "weird", customer: "cus_3", metadata: { workspace_id: "ws-3" } } },
      }),
    ).toBeNull();
  });

  it("returns null when the subscription object has no id", () => {
    expect(
      snapshotFromStripeEvent({
        id: "evt_x",
        type: "customer.subscription.updated",
        data: { object: { status: "active", metadata: { workspace_id: "ws-x" } } },
      }),
    ).toBeNull();
  });

  it("returns null when the customer id is absent", () => {
    expect(
      snapshotFromStripeEvent({
        id: "evt_y",
        type: "customer.subscription.updated",
        data: { object: { id: "sub_y", status: "active", metadata: { workspace_id: "ws-y" } } },
      }),
    ).toBeNull();
  });

  it("maps a null currentPeriodEnd when the event omits current_period_end", () => {
    const snapshot = snapshotFromStripeEvent({
      id: "evt_no_period",
      type: "customer.subscription.updated",
      data: {
        object: { id: "sub_np", status: "active", customer: "cus_np", metadata: { workspace_id: "ws-np" } },
      },
    });
    expect(snapshot).toMatchObject({ workspaceId: "ws-np", currentPeriodEnd: null });
  });

  it("maps a deleted subscription to canceled-style snapshot with null period end", () => {
    const snapshot = snapshotFromStripeEvent({
      id: "evt_5",
      type: "customer.subscription.deleted",
      data: {
        object: {
          id: "sub_4",
          status: "canceled",
          customer: { id: "cus_4" },
          current_period_end: null,
          metadata: { workspace_id: "ws-4" },
        },
      },
    });
    expect(snapshot).toMatchObject({
      workspaceId: "ws-4",
      status: "canceled",
      currentPeriodEnd: null,
      priceInterval: null,
    });
  });
});
