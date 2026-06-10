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

/**
 * Scoped by the invocation timestamp (`appliedAt`) on purpose: the sync handler is
 * convergent and row-locked, so re-running it is always safe, while a long-lived cached
 * completion is not — a key built only from (sub, status, periodEnd) replays for 30 days
 * and strands real transitions (override cleared, A→B→A status round-trips). The key
 * therefore only dedupes retries of the same attempt, not distinct attempts.
 */
export function billingSyncIdempotencyKey(input: {
  subscriptionId: string;
  status: SubscriptionStatus | null;
  currentPeriodEnd: string | null;
  appliedAt: string;
}): string {
  return `sync:${input.subscriptionId}:${input.status ?? "none"}:${input.currentPeriodEnd ?? "none"}:${input.appliedAt}`;
}
