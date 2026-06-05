import { describe, expect, it } from "vitest";
import { OperationEvent } from "./admin.js";
import {
  BillingInvoiceListResponse,
  BillingStatusResponse,
  CreateCheckoutSessionRequest,
  SetWorkspacePlanRequest,
} from "./billing.js";
import { OperationEventAction } from "./enums.js";

describe("billing contracts", () => {
  it("accepts the workspace.plan.updated operation event action", () => {
    expect(OperationEventAction.parse("workspace.plan.updated")).toBe("workspace.plan.updated");
  });

  it("parses a plan-update operation event end to end", () => {
    const event = OperationEvent.parse({
      id: "evt_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
      workspace_id: "3f13401f-1fdc-4bb7-85ff-9c73e357b16a",
      actor_type: "system",
      actor_id: "stripe_webhook",
      action: "workspace.plan.updated",
      target_type: "workspace",
      target_id: "3f13401f-1fdc-4bb7-85ff-9c73e357b16a",
      details: { previous_plan: "free", plan: "pro", source: "stripe_webhook" },
      request_id: null,
      occurred_at: "2026-06-04T00:00:00.000Z",
    });
    expect(event.action).toBe("workspace.plan.updated");
  });

  it("validates the checkout request interval", () => {
    expect(CreateCheckoutSessionRequest.parse({ interval: "month" }).interval).toBe("month");
    expect(CreateCheckoutSessionRequest.safeParse({ interval: "week" }).success).toBe(false);
  });

  it("allows clearing the operator override with a null plan", () => {
    expect(SetWorkspacePlanRequest.parse({ plan: null }).plan).toBeNull();
    expect(SetWorkspacePlanRequest.parse({ plan: "pro" }).plan).toBe("pro");
    expect(SetWorkspacePlanRequest.safeParse({ plan: "enterprise" }).success).toBe(false);
  });

  it("shapes a billing status response with the write allowance", () => {
    const status = BillingStatusResponse.parse({
      plan: "pro",
      operator_override: false,
      subscription: { status: "active", current_period_end: "2026-07-04T00:00:00.000Z", price_interval: "month" },
      daily_new_artifact_allowance: 2000,
      daily_new_artifacts_remaining: 1884,
    });
    expect(status.subscription?.status).toBe("active");
    expect(status.daily_new_artifact_allowance).toBe(2000);
    expect(status.daily_new_artifacts_remaining).toBe(1884);
  });

  it("treats the remaining write count as optional", () => {
    const status = BillingStatusResponse.parse({
      plan: "free",
      operator_override: false,
      subscription: null,
      daily_new_artifact_allowance: 100,
    });
    expect(status.daily_new_artifacts_remaining).toBeUndefined();
  });

  it("shapes an invoice list response", () => {
    const list = BillingInvoiceListResponse.parse({
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
    expect(list.invoices[0]?.amount_due).toBe(1200);
  });
});
