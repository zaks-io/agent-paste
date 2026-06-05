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
});
export type BillingStatusResponse = z.infer<typeof BillingStatusResponse>;

export const WebhookReceivedResponse = z.object({
  received: z.boolean(),
});
export type WebhookReceivedResponse = z.infer<typeof WebhookReceivedResponse>;

/** `null` clears the operator override so Stripe state resumes control. */
export const SetWorkspacePlanRequest = z.object({
  plan: WorkspacePlan.nullable(),
});
export type SetWorkspacePlanRequest = z.infer<typeof SetWorkspacePlanRequest>;
