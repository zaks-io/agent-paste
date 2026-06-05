import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { z } from "../zod.js";
import { errorResponse, jsonOk, schemaRef, standardJsonResponses } from "./responses.js";

type Helpers = {
  params: (paramSchemas: Record<string, z.ZodTypeAny>) => z.ZodObject<z.ZodRawShape>;
  pathStringParam: (name: string, description: string) => z.ZodTypeAny;
  idempotencyKeyHeader: z.ZodTypeAny;
  requestIdHeader: z.ZodTypeAny;
};

/**
 * Stripe billing OpenAPI paths (ADR 0073/0074), split out of `api.ts` to keep each file
 * under the `noExcessiveLinesPerFile` limit.
 */
export function registerBillingPaths(registry: OpenAPIRegistry, helpers: Helpers): void {
  const { params, pathStringParam, idempotencyKeyHeader, requestIdHeader } = helpers;
  const stripeSignatureHeader = z
    .string()
    .min(1)
    .openapi({
      param: { name: "Stripe-Signature", in: "header", required: true },
      description: "Stripe webhook signature (`t=...,v1=...`), verified before any processing.",
    });

  registry.registerPath({
    method: "get",
    path: "/v1/web/billing",
    operationId: "billing.status.get",
    summary: "Read the current Workspace plan and Stripe subscription mirror.",
    security: [{ WorkOsBearer: [] }],
    request: { headers: [requestIdHeader] },
    responses: standardJsonResponses(schemaRef("BillingStatusResponse")),
  });

  registry.registerPath({
    method: "post",
    path: "/v1/web/billing/checkout",
    operationId: "billing.checkout.create",
    summary: "Create a Stripe Checkout session to upgrade the Workspace to Pro.",
    security: [{ WorkOsBearer: [] }],
    request: {
      headers: [idempotencyKeyHeader, requestIdHeader],
      body: {
        required: true,
        content: { "application/json": { schema: schemaRef("CreateCheckoutSessionRequest") } },
      },
    },
    responses: standardJsonResponses(schemaRef("CheckoutSessionResponse")),
  });

  registry.registerPath({
    method: "get",
    path: "/v1/web/billing/return",
    operationId: "billing.checkout.return",
    summary: "Synchronously activate Pro on return from Stripe Checkout.",
    security: [{ WorkOsBearer: [] }],
    request: {
      query: z.object({
        session_id: z
          .string()
          .min(1)
          .openapi({
            param: { name: "session_id", in: "query", required: true, description: "Stripe Checkout session id." },
          }),
      }),
      headers: [requestIdHeader],
    },
    responses: standardJsonResponses(schemaRef("BillingStatusResponse")),
  });

  registry.registerPath({
    method: "post",
    path: "/v1/web/billing/portal",
    operationId: "billing.portal.create",
    summary: "Create a Stripe Customer Portal session for the Workspace.",
    security: [{ WorkOsBearer: [] }],
    request: { headers: [requestIdHeader] },
    responses: standardJsonResponses(schemaRef("PortalSessionResponse")),
  });

  registry.registerPath({
    method: "post",
    path: "/v1/billing/webhook",
    operationId: "billing.webhook",
    summary: "Receive Stripe subscription lifecycle webhooks (Stripe-Signature verified).",
    request: { headers: [stripeSignatureHeader, requestIdHeader] },
    responses: {
      "200": jsonOk(schemaRef("WebhookReceivedResponse"), "Received (200)"),
      "400": errorResponse,
      "404": errorResponse,
      "500": errorResponse,
      "503": errorResponse,
    },
  });

  registry.registerPath({
    method: "post",
    path: "/v1/web/admin/workspaces/{workspace_id}/plan",
    operationId: "billing.admin.setPlan",
    summary: "Set or clear an operator plan override for a Workspace (operator only).",
    security: [{ WorkOsBearer: [], CfAccessServiceToken: [] }],
    request: {
      params: params({ workspace_id: pathStringParam("workspace_id", "Workspace id.") }),
      headers: [idempotencyKeyHeader, requestIdHeader],
      body: { required: true, content: { "application/json": { schema: schemaRef("SetWorkspacePlanRequest") } } },
    },
    responses: standardJsonResponses(schemaRef("BillingStatusResponse")),
  });
}
