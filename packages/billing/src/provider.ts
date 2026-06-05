import type { SubscriptionStatus } from "./plan.js";

export type BillingSubscriptionSnapshot = {
  workspaceId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  status: SubscriptionStatus;
  currentPeriodEnd: string | null;
  priceInterval: "month" | "year" | null;
};

export type CreateCheckoutSessionInput = {
  workspaceId: string;
  customerId?: string | null;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
  idempotencyKey: string;
};

export type CheckoutSessionSnapshot = {
  subscriptionId: string | null;
  customerId: string | null;
};

export type CreatePortalSessionInput = {
  customerId: string;
  returnUrl: string;
};

export type BillingProvider = {
  getSubscription(subscriptionId: string): Promise<BillingSubscriptionSnapshot | null>;
  listReconciliationSubscriptions(): Promise<BillingSubscriptionSnapshot[]>;
  createCheckoutSession(input: CreateCheckoutSessionInput): Promise<{ url: string }>;
  getCheckoutSession(sessionId: string): Promise<CheckoutSessionSnapshot | null>;
  createPortalSession(input: CreatePortalSessionInput): Promise<{ url: string }>;
};

export function createNoopBillingProvider(): BillingProvider {
  return {
    async getSubscription() {
      return null;
    },
    async listReconciliationSubscriptions() {
      return [];
    },
    async createCheckoutSession() {
      throw new Error("billing_disabled");
    },
    async getCheckoutSession() {
      return null;
    },
    async createPortalSession() {
      throw new Error("billing_disabled");
    },
  };
}

export type FakeBillingProviderState = {
  subscriptions: Map<string, BillingSubscriptionSnapshot>;
  checkoutSessions: Map<string, CheckoutSessionSnapshot>;
  checkoutCalls: CreateCheckoutSessionInput[];
  portalCalls: CreatePortalSessionInput[];
};

export function createFakeBillingProvider(
  state: FakeBillingProviderState = {
    subscriptions: new Map(),
    checkoutSessions: new Map(),
    checkoutCalls: [],
    portalCalls: [],
  },
): BillingProvider & {
  setSubscription(snapshot: BillingSubscriptionSnapshot): void;
  updateStatus(subscriptionId: string, status: SubscriptionStatus): void;
  setCheckoutSession(sessionId: string, snapshot: CheckoutSessionSnapshot): void;
  checkoutCalls: CreateCheckoutSessionInput[];
  portalCalls: CreatePortalSessionInput[];
} {
  return {
    async getSubscription(subscriptionId) {
      return state.subscriptions.get(subscriptionId) ?? null;
    },
    async listReconciliationSubscriptions() {
      return [...state.subscriptions.values()];
    },
    async createCheckoutSession(input) {
      state.checkoutCalls.push(input);
      return { url: `https://stripe.test/checkout/${input.workspaceId}` };
    },
    async getCheckoutSession(sessionId) {
      return state.checkoutSessions.get(sessionId) ?? null;
    },
    async createPortalSession(input) {
      state.portalCalls.push(input);
      return { url: `https://stripe.test/portal/${input.customerId}` };
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
    setCheckoutSession(sessionId, snapshot) {
      state.checkoutSessions.set(sessionId, snapshot);
    },
    checkoutCalls: state.checkoutCalls,
    portalCalls: state.portalCalls,
  };
}

export type StripeBillingProviderConfig = {
  secretKey: string;
  fetchImpl?: typeof fetch;
};

export function createStripeBillingProvider(config: StripeBillingProviderConfig): BillingProvider {
  const fetchImpl = config.fetchImpl ?? fetch;
  const authHeader = `Bearer ${config.secretKey}`;

  async function postForm(
    path: string,
    form: URLSearchParams,
    headers: Record<string, string> = {},
  ): Promise<Record<string, unknown>> {
    const response = await fetchImpl(`https://api.stripe.com${path}`, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/x-www-form-urlencoded",
        ...headers,
      },
      body: form.toString(),
    });
    if (!response.ok) {
      throw new Error(`stripe_request_failed:${path}:${response.status}`);
    }
    return (await response.json()) as Record<string, unknown>;
  }

  return {
    async createCheckoutSession(input) {
      const form = new URLSearchParams({
        mode: "subscription",
        "line_items[0][price]": input.priceId,
        "line_items[0][quantity]": "1",
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        "metadata[workspace_id]": input.workspaceId,
        "subscription_data[metadata][workspace_id]": input.workspaceId,
      });
      if (input.customerId) {
        form.set("customer", input.customerId);
      }
      const body = await postForm("/v1/checkout/sessions", form, { "Idempotency-Key": input.idempotencyKey });
      const url = typeof body.url === "string" ? body.url : null;
      if (!url) {
        throw new Error("stripe_checkout_session_missing_url");
      }
      return { url };
    },
    async getCheckoutSession(sessionId) {
      const response = await fetchImpl(
        `https://api.stripe.com/v1/checkout/sessions/${sessionId}?expand[]=subscription`,
        { headers: { Authorization: authHeader } },
      );
      if (response.status === 404) {
        return null;
      }
      if (!response.ok) {
        throw new Error(`stripe_checkout_session_fetch_failed:${response.status}`);
      }
      const body = (await response.json()) as StripeCheckoutSessionResponse;
      return mapCheckoutSession(body);
    },
    async createPortalSession(input) {
      const form = new URLSearchParams({ customer: input.customerId, return_url: input.returnUrl });
      const body = await postForm("/v1/billing_portal/sessions", form);
      const url = typeof body.url === "string" ? body.url : null;
      if (!url) {
        throw new Error("stripe_portal_session_missing_url");
      }
      return { url };
    },
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

type StripeCheckoutSessionResponse = {
  customer: string | { id: string } | null;
  subscription: string | { id: string } | null;
};

function mapCheckoutSession(body: StripeCheckoutSessionResponse): CheckoutSessionSnapshot {
  const subscriptionId = typeof body.subscription === "string" ? body.subscription : (body.subscription?.id ?? null);
  const customerId = typeof body.customer === "string" ? body.customer : (body.customer?.id ?? null);
  return { subscriptionId, customerId };
}

type StripeSubscriptionResponse = {
  id: string;
  status: string;
  customer: string | { id: string };
  current_period_end?: number | null;
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
    currentPeriodEnd: epochSecondsToIso(body.current_period_end),
    priceInterval,
  };
}

/** Stripe omits `current_period_end` on newer API versions; treat absent as null, not NaN. */
export function epochSecondsToIso(value: number | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return new Date(value * 1000).toISOString();
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
