import { describe, expect, it } from "vitest";
import { subscriptionReferenceFromStripeEvent, verifyStripeSignature } from "./webhook.js";

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

describe("subscriptionReferenceFromStripeEvent", () => {
  it("extracts only identifiers from a subscription event", () => {
    const reference = subscriptionReferenceFromStripeEvent({
      id: "evt_1",
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_1",
          customer: "cus_1",
          metadata: { workspace_id: "ws-1" },
        },
      },
    });
    expect(reference).toEqual({
      eventId: "evt_1",
      eventType: "customer.subscription.updated",
      subscriptionId: "sub_1",
      workspaceId: "ws-1",
      stripeCustomerId: "cus_1",
    });
  });

  it("allows workspace and customer to be resolved after the current subscription fetch", () => {
    const reference = subscriptionReferenceFromStripeEvent({
      id: "evt_reference",
      type: "customer.subscription.updated",
      data: { object: { id: "sub_item" } },
    });
    expect(reference).toMatchObject({ subscriptionId: "sub_item", workspaceId: null, stripeCustomerId: null });
  });

  it("treats any customer.subscription event as a current-state notification", () => {
    const reference = subscriptionReferenceFromStripeEvent({
      id: "evt_paused",
      type: "customer.subscription.paused",
      data: { object: { id: "sub_paused", customer: { id: "cus_paused" } } },
    });
    expect(reference).toMatchObject({
      eventId: "evt_paused",
      eventType: "customer.subscription.paused",
      subscriptionId: "sub_paused",
      stripeCustomerId: "cus_paused",
    });
  });

  it("returns null for irrelevant event types", () => {
    expect(
      subscriptionReferenceFromStripeEvent({ id: "evt_2", type: "invoice.paid", data: { object: { id: "in_1" } } }),
    ).toBeNull();
  });

  it("returns null when the subscription object has no id", () => {
    expect(
      subscriptionReferenceFromStripeEvent({
        id: "evt_x",
        type: "customer.subscription.updated",
        data: { object: { metadata: { workspace_id: "ws-x" } } },
      }),
    ).toBeNull();
  });

  it("returns null when the event has no id", () => {
    expect(
      subscriptionReferenceFromStripeEvent({
        type: "customer.subscription.updated",
        data: { object: { id: "sub_y", customer: "cus_y", metadata: { workspace_id: "ws-y" } } },
      }),
    ).toBeNull();
  });
});
