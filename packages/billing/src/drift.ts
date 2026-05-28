export type BillingDriftField =
  | "plan"
  | "subscription_status"
  | "current_period_end"
  | "price_interval"
  | "stripe_customer_id"
  | "stripe_subscription_id";

export type BillingDriftEvent = {
  workspace_id: string;
  field: BillingDriftField;
  local: string | null;
  remote: string | null;
};

export type BillingDriftLogger = (event: string, fields: Record<string, unknown>) => void;

export function detectBillingDrift(input: {
  workspaceId: string;
  local: {
    plan: string;
    stripe_customer_id: string | null;
    stripe_subscription_id: string | null;
    subscription_status: string | null;
    current_period_end: string | null;
    price_interval: string | null;
  };
  remote: {
    plan: string;
    stripe_customer_id: string;
    stripe_subscription_id: string;
    subscription_status: string;
    current_period_end: string | null;
    price_interval: string | null;
  };
}): BillingDriftEvent[] {
  const events: BillingDriftEvent[] = [];
  const base = { workspace_id: input.workspaceId };
  const compare = (field: BillingDriftField, local: string | null, remote: string | null) => {
    if (local !== remote) {
      events.push({ ...base, field, local, remote });
    }
  };
  compare("plan", input.local.plan, input.remote.plan);
  compare("stripe_customer_id", input.local.stripe_customer_id, input.remote.stripe_customer_id);
  compare("stripe_subscription_id", input.local.stripe_subscription_id, input.remote.stripe_subscription_id);
  compare("subscription_status", input.local.subscription_status, input.remote.subscription_status);
  compare("current_period_end", input.local.current_period_end, input.remote.current_period_end);
  compare("price_interval", input.local.price_interval, input.remote.price_interval);
  return events;
}

export function logBillingDrift(logger: BillingDriftLogger, drift: BillingDriftEvent[]): void {
  for (const entry of drift) {
    logger("billing.drift", {
      workspace_id: entry.workspace_id,
      field: entry.field,
      local: entry.local,
      remote: entry.remote,
    });
  }
}
