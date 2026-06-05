import { createFakeBillingProvider } from "@agent-paste/billing";
import type { SqlExecutor } from "@agent-paste/db";
import { describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env.js";
import {
  billingCheckout,
  billingInvoices,
  billingPortal,
  billingReturn,
  billingStatus,
  billingStatusFromRow,
  billingWebhook,
  resolveApiBillingProvider,
} from "../src/routes/billing.js";
import { webAdminSetWorkspacePlan } from "../src/routes/operator.js";
import {
  contextFor,
  guardFor,
  memberPrincipal,
  operatorPrincipal,
  responseJson,
  workspaceId,
} from "./route-test-helpers.js";

type Row = Record<string, unknown>;

function stubExecutor(handler: (sql: string, params?: readonly unknown[]) => Promise<{ rows: Row[] }>): SqlExecutor & {
  query: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn(handler) as SqlExecutor["query"] & ReturnType<typeof vi.fn>;
  const transaction = vi.fn(async <T>(run: (tx: SqlExecutor) => Promise<T>) =>
    run({ query, transaction }),
  ) as SqlExecutor["transaction"];
  return { query, transaction };
}

const noRows = async () => ({ rows: [] as Row[] });

function billingEnv(overrides: Partial<Env> = {}): Env {
  return {
    BILLING_ENABLED: "true",
    STRIPE_PRICE_ID_MONTHLY: "price_month",
    STRIPE_PRICE_ID_ANNUAL: "price_year",
    WEB_BASE_URL: "https://app.test",
    ...overrides,
  };
}

async function signedStripeHeader(payload: string, secret: string, timestamp: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${payload}`));
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `t=${timestamp},v1=${hex}`;
}

describe("billing routes", () => {
  it("returns not_found for every member route when billing is disabled", async () => {
    const env: Env = { DB: stubExecutor(noRows) };
    const status = await billingStatus(contextFor({ env }), memberPrincipal());
    expect(status.status).toBe(404);
    const checkout = await billingCheckout(contextFor({ env }), memberPrincipal(), guardFor({ interval: "month" }));
    expect(checkout.status).toBe(404);
    const portal = await billingPortal(contextFor({ env }), memberPrincipal());
    expect(portal.status).toBe(404);
    const invoices = await billingInvoices(contextFor({ env }), memberPrincipal());
    expect(invoices.status).toBe(404);
  });

  it("returns not_found for the webhook when no signing secret is configured", async () => {
    const response = await billingWebhook(
      contextFor({ env: { DB: stubExecutor(noRows) }, method: "POST", body: "{}" }),
      { kind: "stripe_webhook_signature" },
    );
    expect(response.status).toBe(404);
  });

  it("reports the current plan and subscription mirror", async () => {
    const executor = stubExecutor(async () => ({
      rows: [
        {
          workspace_id: workspaceId,
          plan: "pro",
          plan_operator_override_at: null,
          stripe_customer_id: "cus_1",
          stripe_subscription_id: "sub_1",
          subscription_status: "active",
          current_period_end: "2026-07-01T00:00:00.000Z",
          price_interval: "month",
        },
      ],
    }));
    const response = await billingStatus(contextFor({ env: billingEnv({ DB: executor }) }), memberPrincipal());
    expect(response.status).toBe(200);
    await expect(responseJson(response)).resolves.toMatchObject({
      plan: "pro",
      operator_override: false,
      subscription: { status: "active", price_interval: "month" },
      daily_new_artifact_allowance: 2000,
    });
  });

  it("surfaces the live remaining write count when the allowance binding resolves", async () => {
    const executor = stubExecutor(async () => ({
      rows: [
        {
          workspace_id: workspaceId,
          plan: "free",
          plan_operator_override_at: null,
          stripe_customer_id: null,
          stripe_subscription_id: null,
          subscription_status: null,
          current_period_end: null,
          price_interval: null,
        },
      ],
    }));
    const WRITE_ALLOWANCE = {
      idFromName: () => ({}) as DurableObjectId,
      get: () => ({
        fetch: async () =>
          new Response(JSON.stringify({ consumed: 13, remaining: 87, retry_after_seconds: 0 }), {
            headers: { "content-type": "application/json" },
          }),
      }),
    } as unknown as Env["WRITE_ALLOWANCE"];
    const response = await billingStatus(
      contextFor({ env: billingEnv({ DB: executor, WRITE_ALLOWANCE }) }),
      memberPrincipal(),
    );
    await expect(responseJson(response)).resolves.toMatchObject({
      daily_new_artifact_allowance: 100,
      daily_new_artifacts_remaining: 87,
    });
  });

  it("omits the remaining write count when no allowance binding is bound", async () => {
    const executor = stubExecutor(async () => ({
      rows: [
        {
          workspace_id: workspaceId,
          plan: "free",
          plan_operator_override_at: null,
          stripe_customer_id: null,
          stripe_subscription_id: null,
          subscription_status: null,
          current_period_end: null,
          price_interval: null,
        },
      ],
    }));
    const response = await billingStatus(contextFor({ env: billingEnv({ DB: executor }) }), memberPrincipal());
    const body = (await responseJson(response)) as Record<string, unknown>;
    expect(body.daily_new_artifacts_remaining).toBeUndefined();
    expect(body.daily_new_artifact_allowance).toBe(100);
  });

  it("creates a checkout session and returns the provider url", async () => {
    const provider = createFakeBillingProvider();
    const response = await billingCheckout(
      contextFor({ env: billingEnv({ DB: stubExecutor(noRows) }) }),
      memberPrincipal(),
      guardFor({ interval: "month" }),
      undefined,
      { provider },
    );
    expect(response.status).toBe(200);
    await expect(responseJson(response)).resolves.toMatchObject({ url: `https://stripe.test/checkout/${workspaceId}` });
    expect(provider.checkoutCalls[0]).toMatchObject({ priceId: "price_month", idempotencyKey: "idem_1" });
  });

  it("rejects checkout when the matching price id is not configured", async () => {
    const env = billingEnv({ DB: stubExecutor(noRows), STRIPE_PRICE_ID_MONTHLY: undefined });
    const response = await billingCheckout(
      contextFor({ env }),
      memberPrincipal(),
      guardFor({ interval: "month" }),
      undefined,
      { provider: createFakeBillingProvider() },
    );
    expect(response.status).toBe(404);
  });

  it("returns not_found from the portal when the workspace has no stripe customer", async () => {
    const env = billingEnv({
      DB: stubExecutor(async () => ({
        rows: [
          {
            workspace_id: workspaceId,
            plan: "free",
            plan_operator_override_at: null,
            stripe_customer_id: null,
            stripe_subscription_id: null,
            subscription_status: null,
            current_period_end: null,
            price_interval: null,
          },
        ],
      })),
    });
    const response = await billingPortal(contextFor({ env }), memberPrincipal(), undefined, {
      provider: createFakeBillingProvider(),
    });
    expect(response.status).toBe(404);
  });

  it("opens a portal session for a workspace with a stripe customer", async () => {
    const provider = createFakeBillingProvider();
    const env = billingEnv({
      DB: stubExecutor(async () => ({
        rows: [
          {
            workspace_id: workspaceId,
            plan: "pro",
            plan_operator_override_at: null,
            stripe_customer_id: "cus_1",
            stripe_subscription_id: "sub_1",
            subscription_status: "active",
            current_period_end: null,
            price_interval: "month",
          },
        ],
      })),
    });
    const response = await billingPortal(contextFor({ env }), memberPrincipal(), undefined, { provider });
    expect(response.status).toBe(200);
    await expect(responseJson(response)).resolves.toMatchObject({ url: "https://stripe.test/portal/cus_1" });
  });

  it("returns an empty invoice list for a workspace with no stripe customer", async () => {
    const env = billingEnv({
      DB: stubExecutor(async () => ({
        rows: [
          {
            workspace_id: workspaceId,
            plan: "free",
            plan_operator_override_at: null,
            stripe_customer_id: null,
            stripe_subscription_id: null,
            subscription_status: null,
            current_period_end: null,
            price_interval: null,
          },
        ],
      })),
    });
    const provider = createFakeBillingProvider();
    const response = await billingInvoices(contextFor({ env }), memberPrincipal(), undefined, { provider });
    expect(response.status).toBe(200);
    await expect(responseJson(response)).resolves.toEqual({ invoices: [] });
    expect(provider.invoiceCalls).toHaveLength(0);
  });

  it("lists the workspace's stripe invoices mapped to the contract shape", async () => {
    const provider = createFakeBillingProvider();
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
    const env = billingEnv({
      DB: stubExecutor(async () => ({
        rows: [
          {
            workspace_id: workspaceId,
            plan: "pro",
            plan_operator_override_at: null,
            stripe_customer_id: "cus_1",
            stripe_subscription_id: "sub_1",
            subscription_status: "active",
            current_period_end: null,
            price_interval: "month",
          },
        ],
      })),
    });
    const response = await billingInvoices(contextFor({ env }), memberPrincipal(), undefined, { provider });
    expect(response.status).toBe(200);
    await expect(responseJson(response)).resolves.toEqual({
      invoices: [
        {
          id: "in_1",
          created: "2026-05-12T00:00:00.000Z",
          amount_due: 1200,
          currency: "usd",
          status: "paid",
          description: "Pro · monthly",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_1",
          invoice_pdf: "https://invoice.stripe.com/i/in_1.pdf",
        },
      ],
    });
    expect(provider.invoiceCalls).toEqual([{ customerId: "cus_1" }]);
  });

  it("requires a session_id on the checkout return", async () => {
    const response = await billingReturn(
      contextFor({ env: billingEnv({ DB: stubExecutor(noRows) }), url: "https://api.test/v1/web/billing/return" }),
      memberPrincipal(),
      undefined,
      { provider: createFakeBillingProvider() },
    );
    expect(response.status).toBe(400);
  });

  it("rejects a webhook with an invalid signature before any db write", async () => {
    const executor = stubExecutor(noRows);
    const env: Env = { ...billingEnv(), STRIPE_WEBHOOK_SIGNING_SECRET: "whsec_test", DB: executor };
    const response = await billingWebhook(
      contextFor({
        env,
        method: "POST",
        body: JSON.stringify({ id: "evt_1" }),
        headers: { "stripe-signature": "t=1,v1=deadbeef" },
      }),
      { kind: "stripe_webhook_signature" },
    );
    expect(response.status).toBe(400);
    expect(executor.query).not.toHaveBeenCalled();
  });

  it("200s and ignores a verified webhook for an irrelevant event type", async () => {
    const secret = "whsec_test";
    const executor = stubExecutor(noRows);
    const payload = JSON.stringify({ id: "evt_2", type: "invoice.paid", data: { object: { id: "in_1" } } });
    const header = await signedStripeHeader(payload, secret, Math.floor(Date.now() / 1000));
    const env: Env = { ...billingEnv(), STRIPE_WEBHOOK_SIGNING_SECRET: secret, DB: executor };
    const response = await billingWebhook(
      contextFor({ env, method: "POST", body: payload, headers: { "stripe-signature": header } }),
      { kind: "stripe_webhook_signature" },
    );
    expect(response.status).toBe(200);
    await expect(responseJson(response)).resolves.toEqual({ received: true });
    expect(executor.query).not.toHaveBeenCalled();
  });

  it("collapses the operator plan override to not_found for non-operators", async () => {
    const executor = stubExecutor(noRows);
    const response = await webAdminSetWorkspacePlan(
      contextFor({ env: billingEnv({ DB: executor }) }),
      memberPrincipal(),
      guardFor({ plan: "pro" }),
      { workspaceId },
    );
    expect(response.status).toBe(404);
    expect(executor.query).not.toHaveBeenCalled();
  });

  it("returns not_found for the operator plan override when billing is disabled", async () => {
    const executor = stubExecutor(noRows);
    const response = await webAdminSetWorkspacePlan(
      contextFor({ env: { DB: executor } }),
      operatorPrincipal(),
      guardFor({ plan: "pro" }),
      { workspaceId },
    );
    expect(response.status).toBe(404);
    expect(executor.query).not.toHaveBeenCalled();
  });

  it("returns not_found when the operator targets a malformed workspace id", async () => {
    const executor = stubExecutor(noRows);
    const response = await webAdminSetWorkspacePlan(
      contextFor({ env: billingEnv({ DB: executor }) }),
      operatorPrincipal(),
      guardFor({ plan: "pro" }),
      { workspaceId: "not-a-uuid" },
    );
    expect(response.status).toBe(404);
    expect(executor.query).not.toHaveBeenCalled();
  });

  it("resolveApiBillingProvider returns a Stripe provider when a secret key is set", () => {
    expect(resolveApiBillingProvider({ STRIPE_SECRET_KEY: "sk_test" })).toBeDefined();
    expect(resolveApiBillingProvider({})).toBeDefined();
  });

  it("billingStatusFromRow handles null rows and null subscription status", () => {
    expect(billingStatusFromRow(null)).toEqual({
      plan: "free",
      operator_override: false,
      subscription: null,
      daily_new_artifact_allowance: 100,
    });
    expect(
      billingStatusFromRow({
        workspace_id: workspaceId,
        plan: "free",
        plan_operator_override_at: "2026-06-04T00:00:00.000Z",
        stripe_customer_id: "cus_1",
        stripe_subscription_id: null,
        subscription_status: null,
        current_period_end: null,
        price_interval: null,
      }),
    ).toEqual({ plan: "free", operator_override: true, subscription: null, daily_new_artifact_allowance: 100 });
  });

  it("billingStatusFromRow reports the pro write ceiling", () => {
    expect(
      billingStatusFromRow({
        workspace_id: workspaceId,
        plan: "pro",
        plan_operator_override_at: null,
        stripe_customer_id: "cus_1",
        stripe_subscription_id: "sub_1",
        subscription_status: "active",
        current_period_end: "2026-07-01T00:00:00.000Z",
        price_interval: "month",
      }).daily_new_artifact_allowance,
    ).toBe(2000);
  });

  it("returns database_unavailable from each route when no executor is bound", async () => {
    const env = billingEnv({ DB: undefined });
    expect((await billingStatus(contextFor({ env }), memberPrincipal())).status).toBe(503);
    expect(
      (
        await billingCheckout(contextFor({ env }), memberPrincipal(), guardFor({ interval: "month" }), undefined, {
          provider: createFakeBillingProvider(),
        })
      ).status,
    ).toBe(503);
    expect(
      (
        await billingPortal(contextFor({ env }), memberPrincipal(), undefined, {
          provider: createFakeBillingProvider(),
        })
      ).status,
    ).toBe(503);
    expect(
      (
        await billingReturn(
          contextFor({ env, url: "https://api.test/v1/web/billing/return?session_id=cs_1" }),
          memberPrincipal(),
          undefined,
          { provider: createFakeBillingProvider() },
        )
      ).status,
    ).toBe(503);
  });

  it("returns forbidden when the principal is not a workspace member", async () => {
    const env = billingEnv({ DB: stubExecutor(noRows) });
    const operator = operatorPrincipal();
    expect((await billingStatus(contextFor({ env }), operator)).status).toBe(403);
    expect(
      (
        await billingCheckout(contextFor({ env }), operator, guardFor({ interval: "month" }), undefined, {
          provider: createFakeBillingProvider(),
        })
      ).status,
    ).toBe(403);
    expect(
      (await billingPortal(contextFor({ env }), operator, undefined, { provider: createFakeBillingProvider() })).status,
    ).toBe(403);
    expect(
      (await billingReturn(contextFor({ env }), operator, undefined, { provider: createFakeBillingProvider() })).status,
    ).toBe(403);
  });

  it("uses the annual price id for a yearly checkout", async () => {
    const provider = createFakeBillingProvider();
    await billingCheckout(
      contextFor({ env: billingEnv({ DB: stubExecutor(noRows) }) }),
      memberPrincipal(),
      guardFor({ interval: "year" }),
      undefined,
      { provider },
    );
    expect(provider.checkoutCalls[0]).toMatchObject({ priceId: "price_year" });
  });

  it("does not activate when the returned subscription belongs to another workspace", async () => {
    const provider = createFakeBillingProvider();
    provider.setCheckoutSession("cs_1", { subscriptionId: "sub_1", customerId: "cus_1" });
    provider.setSubscription({
      workspaceId: "99999999-9999-4999-8999-999999999999",
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: "sub_1",
      status: "active",
      currentPeriodEnd: null,
      priceInterval: "month",
    });
    const executor = stubExecutor(noRows);
    const response = await billingReturn(
      contextFor({ env: billingEnv({ DB: executor }), url: "https://api.test/v1/web/billing/return?session_id=cs_1" }),
      memberPrincipal(),
      undefined,
      { provider },
    );
    expect(response.status).toBe(200);
    // No applyBillingSnapshot ran (mismatched workspace), so only the status read hit the db.
    await expect(responseJson(response)).resolves.toMatchObject({ plan: "free" });
  });

  // runCommand claims the idempotency record (returning a row) and then the handler's
  // `select plan from workspaces` comes back empty, so it throws "workspace_not_found".
  const missingWorkspaceExecutor = () =>
    stubExecutor(async (sql) => {
      if (sql.includes("insert into idempotency_records")) {
        return { rows: [{ workspace_id: workspaceId }] };
      }
      return { rows: [] };
    });

  it("200s a verified webhook whose workspace no longer exists so Stripe stops retrying", async () => {
    const secret = "whsec_test";
    const executor = missingWorkspaceExecutor();
    const payload = JSON.stringify({
      id: "evt_gone",
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_gone",
          status: "active",
          customer: "cus_gone",
          current_period_end: 1_900_000_000,
          metadata: { workspace_id: workspaceId },
        },
      },
    });
    const header = await signedStripeHeader(payload, secret, Math.floor(Date.now() / 1000));
    const env: Env = { ...billingEnv(), STRIPE_WEBHOOK_SIGNING_SECRET: secret, DB: executor };
    const response = await billingWebhook(
      contextFor({ env, method: "POST", body: payload, headers: { "stripe-signature": header } }),
      { kind: "stripe_webhook_signature" },
    );
    expect(response.status).toBe(200);
    await expect(responseJson(response)).resolves.toEqual({ received: true });
  });

  it("maps a missing workspace on operator plan override to not_found", async () => {
    const response = await webAdminSetWorkspacePlan(
      contextFor({ env: billingEnv({ DB: missingWorkspaceExecutor() }) }),
      operatorPrincipal(),
      guardFor({ plan: "pro" }),
      { workspaceId },
    );
    expect(response.status).toBe(404);
  });

  it("returns the current status on checkout return when the session has no subscription", async () => {
    const provider = createFakeBillingProvider();
    provider.setCheckoutSession("cs_2", { subscriptionId: null, customerId: "cus_1" });
    const executor = stubExecutor(noRows);
    const response = await billingReturn(
      contextFor({ env: billingEnv({ DB: executor }), url: "https://api.test/v1/web/billing/return?session_id=cs_2" }),
      memberPrincipal(),
      undefined,
      { provider },
    );
    expect(response.status).toBe(200);
    await expect(responseJson(response)).resolves.toMatchObject({ plan: "free" });
  });
});
