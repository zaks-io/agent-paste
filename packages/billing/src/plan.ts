export type WorkspacePlan = "free" | "pro";

export type SubscriptionStatus =
  | "active"
  | "trialing"
  | "past_due"
  | "canceled"
  | "unpaid"
  | "incomplete"
  | "incomplete_expired"
  | "paused";

const PRO_STATUSES = new Set<SubscriptionStatus>(["active", "trialing", "past_due"]);

export function planFromSubscriptionStatus(status: SubscriptionStatus | null | undefined): WorkspacePlan {
  if (status && PRO_STATUSES.has(status)) {
    return "pro";
  }
  return "free";
}

export function billingSyncIdempotencyKey(input: {
  subscriptionId: string;
  status: SubscriptionStatus | null;
  currentPeriodEnd: string | null;
}): string {
  return `sync:${input.subscriptionId}:${input.status ?? "none"}:${input.currentPeriodEnd ?? "none"}`;
}
