import type { SubscriptionStatus } from "./plan.js";

export type BillingSubscriptionSnapshot = {
  workspaceId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  status: SubscriptionStatus;
  currentPeriodEnd: string | null;
  priceInterval: "month" | "year" | null;
};

export type BillingProvider = {
  getSubscription(subscriptionId: string): Promise<BillingSubscriptionSnapshot | null>;
  listReconciliationSubscriptions(): Promise<BillingSubscriptionSnapshot[]>;
};

export function createNoopBillingProvider(): BillingProvider {
  return {
    async getSubscription() {
      return null;
    },
    async listReconciliationSubscriptions() {
      return [];
    },
  };
}

export type FakeBillingProviderState = {
  subscriptions: Map<string, BillingSubscriptionSnapshot>;
};

export function createFakeBillingProvider(
  state: FakeBillingProviderState = { subscriptions: new Map() },
): BillingProvider & {
  setSubscription(snapshot: BillingSubscriptionSnapshot): void;
  updateStatus(subscriptionId: string, status: SubscriptionStatus): void;
} {
  return {
    async getSubscription(subscriptionId) {
      return state.subscriptions.get(subscriptionId) ?? null;
    },
    async listReconciliationSubscriptions() {
      return [...state.subscriptions.values()];
    },
    setSubscription(snapshot) {
      state.subscriptions.set(snapshot.stripeSubscriptionId, snapshot);
    },
    updateStatus(subscriptionId, status) {
      const existing = state.subscriptions.get(subscriptionId);
      if (!existing) {
        throw new Error(`unknown_subscription:${subscriptionId}`);
      }
      state.subscriptions.set(subscriptionId, { ...existing, status });
    },
  };
}

export type StripeBillingProviderConfig = {
  secretKey: string;
  fetchImpl?: typeof fetch;
};

export function createStripeBillingProvider(config: StripeBillingProviderConfig): BillingProvider {
  const fetchImpl = config.fetchImpl ?? fetch;
  const authHeader = `Bearer ${config.secretKey}`;

  return {
    async getSubscription(subscriptionId) {
      const response = await fetchImpl(`https://api.stripe.com/v1/subscriptions/${subscriptionId}`, {
        headers: { Authorization: authHeader },
      });
      if (response.status === 404) {
        return null;
      }
      if (!response.ok) {
        throw new Error(`stripe_subscription_fetch_failed:${response.status}`);
      }
      const body = (await response.json()) as StripeSubscriptionResponse;
      return mapStripeSubscription(body);
    },
    async listReconciliationSubscriptions() {
      const snapshots: BillingSubscriptionSnapshot[] = [];
      let startingAfter: string | undefined;
      for (;;) {
        const params = new URLSearchParams({ limit: "100", status: "all" });
        if (startingAfter) {
          params.set("starting_after", startingAfter);
        }
        const response = await fetchImpl(`https://api.stripe.com/v1/subscriptions?${params}`, {
          headers: { Authorization: authHeader },
        });
        if (!response.ok) {
          throw new Error(`stripe_subscription_list_failed:${response.status}`);
        }
        const body = (await response.json()) as StripeListResponse<StripeSubscriptionResponse>;
        for (const item of body.data) {
          const mapped = mapStripeSubscription(item);
          if (mapped) {
            snapshots.push(mapped);
          }
        }
        if (!body.has_more || body.data.length === 0) {
          break;
        }
        startingAfter = body.data.at(-1)?.id;
      }
      return snapshots;
    },
  };
}

type StripeListResponse<T> = {
  data: T[];
  has_more: boolean;
};

type StripeSubscriptionResponse = {
  id: string;
  status: string;
  customer: string | { id: string };
  current_period_end: number | null;
  metadata?: Record<string, string>;
  items?: {
    data?: Array<{
      price?: { recurring?: { interval?: string } };
    }>;
  };
};

function mapStripeSubscription(body: StripeSubscriptionResponse): BillingSubscriptionSnapshot | null {
  const workspaceId = body.metadata?.workspace_id;
  if (!workspaceId) {
    return null;
  }
  const status = parseSubscriptionStatus(body.status);
  if (!status) {
    return null;
  }
  const customerId = typeof body.customer === "string" ? body.customer : body.customer.id;
  const interval = body.items?.data?.[0]?.price?.recurring?.interval;
  const priceInterval = interval === "month" || interval === "year" ? interval : null;
  return {
    workspaceId,
    stripeCustomerId: customerId,
    stripeSubscriptionId: body.id,
    status,
    currentPeriodEnd: body.current_period_end === null ? null : new Date(body.current_period_end * 1000).toISOString(),
    priceInterval,
  };
}

function parseSubscriptionStatus(value: string): SubscriptionStatus | null {
  switch (value) {
    case "active":
    case "trialing":
    case "past_due":
    case "canceled":
    case "unpaid":
    case "incomplete":
    case "incomplete_expired":
    case "paused":
      return value;
    default:
      return null;
  }
}
