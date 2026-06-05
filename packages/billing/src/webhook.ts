import type { SubscriptionStatus } from "./plan.js";
import { type BillingSubscriptionSnapshot, epochSecondsToIso } from "./provider.js";

const DEFAULT_TOLERANCE_SECONDS = 300;

export type StripeSignatureResult =
  | { ok: true; event: StripeEvent }
  | { ok: false; reason: "malformed_header" | "no_signature" | "signature_mismatch" | "timestamp_out_of_tolerance" };

export type VerifyStripeSignatureInput = {
  payload: string;
  header: string | null | undefined;
  secret: string;
  /** Unix seconds. Stripe signs with a `t` timestamp; reject when it drifts past tolerance. */
  now: number;
  toleranceSeconds?: number;
};

/**
 * Verify a Stripe webhook signature on the Workers runtime using Web Crypto only.
 * Stripe's scheme: the `Stripe-Signature` header is `t=<unix>,v1=<hex hmac-sha256>` over
 * `${t}.${payload}` keyed by the endpoint signing secret. We recompute v1 and constant-time
 * compare, then enforce the timestamp tolerance so a captured signature cannot be replayed forever.
 */
export async function verifyStripeSignature(input: VerifyStripeSignatureInput): Promise<StripeSignatureResult> {
  const parsed = parseSignatureHeader(input.header);
  if (!parsed) {
    return { ok: false, reason: "malformed_header" };
  }
  if (parsed.signatures.length === 0) {
    return { ok: false, reason: "no_signature" };
  }

  const expected = await hmacHex(`${parsed.timestamp}.${input.payload}`, input.secret);
  const matches = parsed.signatures.some((candidate) => constantTimeEqualHex(candidate, expected));
  if (!matches) {
    return { ok: false, reason: "signature_mismatch" };
  }

  const tolerance = input.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  if (Math.abs(input.now - parsed.timestamp) > tolerance) {
    return { ok: false, reason: "timestamp_out_of_tolerance" };
  }

  let event: StripeEvent;
  try {
    event = JSON.parse(input.payload) as StripeEvent;
  } catch {
    return { ok: false, reason: "malformed_header" };
  }
  return { ok: true, event };
}

export type StripeEvent = {
  id?: string;
  type?: string;
  data?: { object?: StripeSubscriptionObject };
};

type StripeSubscriptionObject = {
  id?: string;
  status?: string;
  customer?: string | { id?: string };
  current_period_end?: number | null;
  metadata?: Record<string, string>;
  items?: { data?: Array<{ price?: { recurring?: { interval?: string } } }> };
};

const SUBSCRIPTION_EVENT_TYPES = new Set([
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
]);

/**
 * Map a subscription-lifecycle event to a snapshot. Returns `null` for irrelevant event types or
 * events missing the workspace_id metadata / a recognized status, so the webhook handler can 200
 * and ignore them. The reconcile/sync path's idempotency keying makes replays and out-of-order
 * delivery safe.
 */
export function snapshotFromStripeEvent(event: StripeEvent): BillingSubscriptionSnapshot | null {
  if (!event.type || !SUBSCRIPTION_EVENT_TYPES.has(event.type)) {
    return null;
  }
  const object = event.data?.object;
  if (!object?.id) {
    return null;
  }
  const workspaceId = object.metadata?.workspace_id;
  if (!workspaceId) {
    return null;
  }
  const status = parseSubscriptionStatus(object.status);
  if (!status) {
    return null;
  }
  const customerId = typeof object.customer === "string" ? object.customer : object.customer?.id;
  if (!customerId) {
    return null;
  }
  const interval = object.items?.data?.[0]?.price?.recurring?.interval;
  const priceInterval = interval === "month" || interval === "year" ? interval : null;
  return {
    workspaceId,
    stripeCustomerId: customerId,
    stripeSubscriptionId: object.id,
    status,
    currentPeriodEnd: epochSecondsToIso(object.current_period_end),
    priceInterval,
  };
}

type ParsedSignature = { timestamp: number; signatures: string[] };

function parseSignatureHeader(header: string | null | undefined): ParsedSignature | null {
  if (!header) {
    return null;
  }
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const [key, value] = part.split("=", 2);
    if (!key || value === undefined) {
      continue;
    }
    if (key.trim() === "t") {
      const parsedTimestamp = Number.parseInt(value, 10);
      if (Number.isFinite(parsedTimestamp)) {
        timestamp = parsedTimestamp;
      }
    } else if (key.trim() === "v1") {
      signatures.push(value.trim());
    }
  }
  if (timestamp === null) {
    return null;
  }
  return { timestamp, signatures };
}

async function hmacHex(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  const bytes = new Uint8Array(signature);
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

/** Length-independent comparison so timing cannot leak the expected signature. */
function constantTimeEqualHex(a: string, b: string): boolean {
  const maxLength = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let index = 0; index < maxLength; index += 1) {
    diff |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
  }
  return diff === 0;
}

function parseSubscriptionStatus(value: string | undefined): SubscriptionStatus | null {
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
