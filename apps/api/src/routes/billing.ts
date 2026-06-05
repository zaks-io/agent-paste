import {
  applyBillingSnapshot,
  type BillingProvider,
  createNoopBillingProvider,
  createStripeBillingProvider,
  type InvoiceSummary,
  type LocalBillingRow,
  loadLocalBillingRow,
  snapshotFromStripeEvent,
  verifyStripeSignature,
} from "@agent-paste/billing";
import { resolveDailyNewArtifactAllowance } from "@agent-paste/config";
import type {
  BillingInvoiceListResponse,
  BillingInvoiceSummary,
  BillingStatusResponse,
  CreateCheckoutSessionRequest,
} from "@agent-paste/contracts";
import { createHyperdriveExecutor, type HyperdriveBinding, rlsExecutor, type SqlExecutor } from "@agent-paste/db";
import type { Principal } from "@agent-paste/worker-runtime";
import { getBoundResponders } from "@agent-paste/worker-runtime";
import { type AppContext, billingEnabled, type Env } from "../env.js";
import { webMemberActor } from "../principals.js";
import { runIdempotent } from "../responses.js";
import type { GuardFor } from "../route-contracts.js";
import { webBaseUrl } from "../runtime.js";
import { readWriteAllowanceRemaining } from "../write-allowance.js";

function isHyperdriveDb(value: unknown): value is HyperdriveBinding {
  return typeof value === "object" && value !== null && "connectionString" in value;
}

function isLocalSqlExecutor(value: unknown): value is SqlExecutor {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as SqlExecutor).query === "function" &&
    typeof (value as SqlExecutor).transaction === "function"
  );
}

/** Raw RLS-capable executor for billing command writes (Stripe is never on the hot path). */
export function resolveBillingExecutor(env: Env): SqlExecutor | undefined {
  const binding: unknown = env.DB;
  if (isLocalSqlExecutor(binding)) {
    return binding;
  }
  if (isHyperdriveDb(binding)) {
    return createHyperdriveExecutor(binding);
  }
  return undefined;
}

export function resolveApiBillingProvider(env: Env): BillingProvider {
  if (env.STRIPE_SECRET_KEY) {
    return createStripeBillingProvider({ secretKey: env.STRIPE_SECRET_KEY });
  }
  return createNoopBillingProvider();
}

export function billingStatusFromRow(row: LocalBillingRow | null): BillingStatusResponse {
  const plan = row?.plan ?? "free";
  // The page is gated behind `billingEnabled`, and a member viewing billing is a
  // claimed workspace, so the ceiling is the plan tier (free=100, pro=2000) rather
  // than the ephemeral/billing-off fallbacks.
  const daily_new_artifact_allowance = resolveDailyNewArtifactAllowance({
    claimedAt: row?.workspace_id ?? "claimed",
    plan,
    billingEnabled: true,
  });
  if (!row) {
    return { plan: "free", operator_override: false, subscription: null, daily_new_artifact_allowance };
  }
  const subscription =
    row.subscription_status === null
      ? null
      : {
          status: row.subscription_status,
          current_period_end: row.current_period_end,
          price_interval: row.price_interval,
        };
  return {
    plan,
    operator_override: row.plan_operator_override_at !== null,
    subscription,
    daily_new_artifact_allowance,
  };
}

/** Adds the live `daily_new_artifacts_remaining` counter when the allowance binding resolves. */
async function enrichBillingStatus(
  env: Env,
  workspaceId: string,
  status: BillingStatusResponse,
): Promise<BillingStatusResponse> {
  const remaining = await readWriteAllowanceRemaining(
    env.WRITE_ALLOWANCE,
    workspaceId,
    status.daily_new_artifact_allowance,
  );
  if (remaining === undefined) {
    return status;
  }
  return { ...status, daily_new_artifacts_remaining: remaining };
}

export async function billingStatus(context: AppContext, principal: Principal): Promise<Response> {
  const { respondError, respondJson } = getBoundResponders(context);
  const env = context.env;
  if (!billingEnabled(env)) {
    return respondError("not_found");
  }
  const actor = webMemberActor(principal);
  if (!actor?.workspace_id) {
    return respondError("forbidden");
  }
  const executor = resolveBillingExecutor(env);
  if (!executor) {
    return respondError("database_unavailable");
  }
  const row = await loadLocalBillingRow(
    rlsExecutor(executor, { kind: "workspace", workspaceId: actor.workspace_id }),
    actor.workspace_id,
  );
  return respondJson(await enrichBillingStatus(env, actor.workspace_id, billingStatusFromRow(row)));
}

export async function billingCheckout(
  context: AppContext,
  principal: Principal,
  guard: GuardFor<"billing.checkout.create">,
  provider: BillingProvider = resolveApiBillingProvider(context.env),
): Promise<Response> {
  const { respondError } = getBoundResponders(context);
  const env = context.env;
  if (!billingEnabled(env)) {
    return respondError("not_found");
  }
  const actor = webMemberActor(principal);
  if (!actor?.workspace_id) {
    return respondError("forbidden");
  }
  const body: CreateCheckoutSessionRequest = guard.body;
  const priceId = body.interval === "year" ? env.STRIPE_PRICE_ID_ANNUAL : env.STRIPE_PRICE_ID_MONTHLY;
  if (!priceId) {
    return respondError("not_found");
  }
  const executor = resolveBillingExecutor(env);
  if (!executor) {
    return respondError("database_unavailable");
  }
  const existing = await loadLocalBillingRow(
    rlsExecutor(executor, { kind: "workspace", workspaceId: actor.workspace_id }),
    actor.workspace_id,
  );
  const base = webBaseUrl(env);
  return runIdempotent(
    context,
    () =>
      provider.createCheckoutSession({
        workspaceId: actor.workspace_id as string,
        customerId: existing?.stripe_customer_id ?? null,
        priceId,
        successUrl: `${base}/settings/billing?status=success&session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${base}/settings/billing?status=cancelled`,
        idempotencyKey: guard.idempotencyKey,
      }),
    { successStatus: 200 },
  );
}

export async function billingReturn(
  context: AppContext,
  principal: Principal,
  provider: BillingProvider = resolveApiBillingProvider(context.env),
): Promise<Response> {
  const { respondError, respondJson } = getBoundResponders(context);
  const env = context.env;
  if (!billingEnabled(env)) {
    return respondError("not_found");
  }
  const actor = webMemberActor(principal);
  if (!actor?.workspace_id) {
    return respondError("forbidden");
  }
  const sessionId = new URL(context.req.raw.url).searchParams.get("session_id");
  if (!sessionId) {
    return respondError("invalid_request");
  }
  const executor = resolveBillingExecutor(env);
  if (!executor) {
    return respondError("database_unavailable");
  }
  const workspaceId = actor.workspace_id;
  const session = await provider.getCheckoutSession(sessionId);
  if (session?.subscriptionId) {
    const snapshot = await provider.getSubscription(session.subscriptionId);
    if (snapshot && snapshot.workspaceId === workspaceId) {
      await applyBillingSnapshot({
        executor: rlsExecutor(executor, { kind: "workspace", workspaceId }),
        actorId: "checkout_activation",
        workspaceId,
        snapshot,
        now: new Date().toISOString(),
      });
    }
  }
  const row = await loadLocalBillingRow(rlsExecutor(executor, { kind: "workspace", workspaceId }), workspaceId);
  return respondJson(await enrichBillingStatus(env, workspaceId, billingStatusFromRow(row)));
}

export async function billingPortal(
  context: AppContext,
  principal: Principal,
  provider: BillingProvider = resolveApiBillingProvider(context.env),
): Promise<Response> {
  const { respondError } = getBoundResponders(context);
  const env = context.env;
  if (!billingEnabled(env)) {
    return respondError("not_found");
  }
  const actor = webMemberActor(principal);
  if (!actor?.workspace_id) {
    return respondError("forbidden");
  }
  const executor = resolveBillingExecutor(env);
  if (!executor) {
    return respondError("database_unavailable");
  }
  const row = await loadLocalBillingRow(
    rlsExecutor(executor, { kind: "workspace", workspaceId: actor.workspace_id }),
    actor.workspace_id,
  );
  if (!row?.stripe_customer_id) {
    return respondError("not_found");
  }
  const session = await provider.createPortalSession({
    customerId: row.stripe_customer_id,
    returnUrl: `${webBaseUrl(env)}/settings/billing`,
  });
  return getBoundResponders(context).respondJson(session);
}

function toContractInvoice(invoice: InvoiceSummary): BillingInvoiceSummary {
  return {
    id: invoice.id,
    created: invoice.created,
    amount_due: invoice.amountDue,
    currency: invoice.currency,
    status: invoice.status,
    description: invoice.description,
    hosted_invoice_url: invoice.hostedInvoiceUrl,
    invoice_pdf: invoice.invoicePdf,
  };
}

export async function billingInvoices(
  context: AppContext,
  principal: Principal,
  provider: BillingProvider = resolveApiBillingProvider(context.env),
): Promise<Response> {
  const { respondError, respondJson } = getBoundResponders(context);
  const env = context.env;
  if (!billingEnabled(env)) {
    return respondError("not_found");
  }
  const actor = webMemberActor(principal);
  if (!actor?.workspace_id) {
    return respondError("forbidden");
  }
  const executor = resolveBillingExecutor(env);
  if (!executor) {
    return respondError("database_unavailable");
  }
  const row = await loadLocalBillingRow(
    rlsExecutor(executor, { kind: "workspace", workspaceId: actor.workspace_id }),
    actor.workspace_id,
  );
  // Free Workspaces have no Stripe customer yet, so there is nothing to list — an
  // empty history is the correct answer, not an error.
  if (!row?.stripe_customer_id) {
    return respondJson({ invoices: [] } satisfies BillingInvoiceListResponse);
  }
  const invoices = await provider.listInvoices({ customerId: row.stripe_customer_id });
  return respondJson({ invoices: invoices.map(toContractInvoice) } satisfies BillingInvoiceListResponse);
}

export async function billingWebhook(context: AppContext, _principal: Principal): Promise<Response> {
  const { respondError, respondJson } = getBoundResponders(context);
  const env = context.env;
  const secret = env.STRIPE_WEBHOOK_SIGNING_SECRET;
  if (!secret) {
    return respondError("not_found");
  }
  const raw = await context.req.raw.text();
  const verified = await verifyStripeSignature({
    payload: raw,
    header: context.req.raw.headers.get("stripe-signature"),
    secret,
    now: Math.floor(Date.now() / 1000),
  });
  if (!verified.ok) {
    return respondError("invalid_request");
  }
  const snapshot = snapshotFromStripeEvent(verified.event);
  if (!snapshot) {
    return respondJson({ received: true });
  }
  const executor = resolveBillingExecutor(env);
  if (!executor) {
    return respondError("database_unavailable");
  }
  try {
    await applyBillingSnapshot({
      executor: rlsExecutor(executor, { kind: "workspace", workspaceId: snapshot.workspaceId }),
      actorId: "stripe_webhook",
      workspaceId: snapshot.workspaceId,
      snapshot,
      now: new Date().toISOString(),
    });
  } catch (error) {
    // A subscription event for a workspace that no longer exists is terminal, not transient.
    // 200 so Stripe stops retrying; anything else is a real failure worth a 5xx + retry.
    if (error instanceof Error && error.message === "workspace_not_found") {
      return respondJson({ received: true });
    }
    throw error;
  }
  return respondJson({ received: true });
}
