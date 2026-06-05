import { WORKSPACE_PLANS } from "@agent-paste/config";
import { IsoDateTime, UrlString } from "./primitives.js";
import { z } from "./zod.js";

export const WorkspacePlan = z.enum(WORKSPACE_PLANS);
export type WorkspacePlan = z.infer<typeof WorkspacePlan>;

export const BillingInterval = z.enum(["month", "year"]);
export type BillingInterval = z.infer<typeof BillingInterval>;

export const SubscriptionStatus = z.enum([
  "active",
  "trialing",
  "past_due",
  "canceled",
  "unpaid",
  "incomplete",
  "incomplete_expired",
  "paused",
]);
export type SubscriptionStatus = z.infer<typeof SubscriptionStatus>;

export const CreateCheckoutSessionRequest = z.object({
  interval: BillingInterval,
});
export type CreateCheckoutSessionRequest = z.infer<typeof CreateCheckoutSessionRequest>;

export const CheckoutSessionResponse = z.object({
  url: UrlString,
});
export type CheckoutSessionResponse = z.infer<typeof CheckoutSessionResponse>;

export const PortalSessionResponse = z.object({
  url: UrlString,
});
export type PortalSessionResponse = z.infer<typeof PortalSessionResponse>;

export const BillingSubscriptionSummary = z.object({
  status: SubscriptionStatus,
  current_period_end: IsoDateTime.nullable(),
  price_interval: BillingInterval.nullable(),
});
export type BillingSubscriptionSummary = z.infer<typeof BillingSubscriptionSummary>;

export const BillingStatusResponse = z.object({
  plan: WorkspacePlan,
  operator_override: z.boolean(),
  subscription: BillingSubscriptionSummary.nullable(),
  /** Daily new-Artifact write ceiling for the current Plan (the rail's "Writes / day"). */
  daily_new_artifact_allowance: z.number().int().positive(),
  /** Live remaining writes today; omitted when the allowance counter binding is absent. */
  daily_new_artifacts_remaining: z.number().int().nonnegative().optional(),
});
export type BillingStatusResponse = z.infer<typeof BillingStatusResponse>;

export const BillingInvoiceSummary = z.object({
  id: z.string(),
  created: IsoDateTime.nullable(),
  /** Amount due in the currency's minor unit (e.g. cents); formatted by the client. */
  amount_due: z.number().int(),
  currency: z.string(),
  status: z.string().nullable(),
  description: z.string().nullable(),
  hosted_invoice_url: UrlString.nullable(),
  invoice_pdf: UrlString.nullable(),
});
export type BillingInvoiceSummary = z.infer<typeof BillingInvoiceSummary>;

export const BillingInvoiceListResponse = z.object({
  invoices: z.array(BillingInvoiceSummary),
});
export type BillingInvoiceListResponse = z.infer<typeof BillingInvoiceListResponse>;

export const WebhookReceivedResponse = z.object({
  received: z.boolean(),
});
export type WebhookReceivedResponse = z.infer<typeof WebhookReceivedResponse>;

/** `null` clears the operator override so Stripe state resumes control. */
export const SetWorkspacePlanRequest = z.object({
  plan: WorkspacePlan.nullable(),
});
export type SetWorkspacePlanRequest = z.infer<typeof SetWorkspacePlanRequest>;
