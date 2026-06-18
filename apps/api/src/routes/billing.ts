import {
  applyBillingSnapshot,
  type BillingProvider,
  createNoopBillingProvider,
  createStripeBillingProvider,
  type InvoiceSummary,
  type LocalBillingRow,
  loadLocalBillingRow,
  processStripeSubscriptionWebhook,
  StripeWebhookEventInProgressError,
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
import { sentryPostgresExecutorOptions } from "@agent-paste/worker-runtime/sentry-sql";
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
    return createHyperdriveExecutor(binding, sentryPostgresExecutorOptions);
  }
  return undefined;
}

export function resolveApiBillingProvider(env: Env): BillingProvider {
  if (env.STRIPE_SECRET_KEY) {
    return createStripeBillingProvider({ secretKey: env.STRIPE_SECRET_KEY });
  }
  return createNoopBillingProvider();
}

type BillingResponders = ReturnType<typeof getBoundResponders>;

/** Test-only override seam: production always uses the env-derived Stripe provider. */
type BillingProviderOverride = { provider?: BillingProvider };

/** The resolved request context every member-facing billing route needs. */
type BillingMemberCtx = {
  env: Env;
  workspaceId: string;
  /** Executor already RLS-scoped to this Workspace; never re-wrap it. */
  db: SqlExecutor;
  respondError: BillingResponders["respondError"];
  respondJson: BillingResponders["respondJson"];
};

/**
 * Resolves the shared preamble for member-facing billing routes: billing must be
 * on, the principal must be a Workspace Member, and the DB must be reachable. On
 * success the executor is already scoped to the member's Workspace. The `executor`
 * is the raw RLS-capable handle the registrar resolved for the route; this scopes
 * it to the member's Workspace. The webhook does not use this — it is
 * signature-authed and scopes to the event's Workspace.
 *
 * `billingEnabled` (→ not_found) is checked before the executor (→ database_unavailable)
 * so a billing-off request 404s even when the DB is unreachable.
 */
export function resolveBillingMemberCtx(
  context: AppContext,
  principal: Principal,
  executor: SqlExecutor | undefined,
): { ok: true; ctx: BillingMemberCtx } | { ok: false; response: Response } {
  const { respondError, respondJson } = getBoundResponders(context);
  const env = context.env;
  if (!billingEnabled(env)) {
    return { ok: false, response: respondError("not_found") };
  }
  const actor = webMemberActor(principal);
  if (!actor?.workspace_id) {
    return { ok: false, response: respondError("forbidden") };
  }
  if (!executor) {
    return { ok: false, response: respondError("database_unavailable") };
  }
  const workspaceId = actor.workspace_id;
  const db = rlsExecutor(executor, { kind: "workspace", workspaceId });
  return { ok: true, ctx: { env, workspaceId, db, respondError, respondJson } };
}

async function runBillingMemberRoute(
  context: AppContext,
  principal: Principal,
  executor: SqlExecutor | undefined,
  run: (ctx: BillingMemberCtx) => Promise<Response> | Response,
): Promise<Response> {
  const resolved = resolveBillingMemberCtx(context, principal, executor);
  if (!resolved.ok) {
    return resolved.response;
  }
  return run(resolved.ctx);
}

export function billingStatusFromRow(row: LocalBillingRow | null): BillingStatusResponse {
  const plan = row?.plan ?? "free";
  // The page is gated behind `billingEnabled`, and a member viewing billing is a
  // claimed workspace, so the ceiling is the plan tier (free=100, pro=2000) rather
  // than the ephemeral/billing-off fallbacks.
  const daily_new_artifact_allowance = resolveDailyNewArtifactAllowance({
    claimed: true,
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

async function respondBillingStatus(ctx: BillingMemberCtx): Promise<Response> {
  const row = await loadLocalBillingRow(ctx.db, ctx.workspaceId);
  return ctx.respondJson(await enrichBillingStatus(ctx.env, ctx.workspaceId, billingStatusFromRow(row)));
}

export async function billingStatus(
  context: AppContext,
  principal: Principal,
  executor: SqlExecutor | undefined = resolveBillingExecutor(context.env),
): Promise<Response> {
  return runBillingMemberRoute(context, principal, executor, respondBillingStatus);
}

export async function billingCheckout(
  context: AppContext,
  principal: Principal,
  guard: GuardFor<"billing.checkout.create">,
  executor: SqlExecutor | undefined = resolveBillingExecutor(context.env),
  { provider = resolveApiBillingProvider(context.env) }: BillingProviderOverride = {},
): Promise<Response> {
  return runBillingMemberRoute(context, principal, executor, async ({ env, workspaceId, db, respondError }) => {
    const body: CreateCheckoutSessionRequest = guard.body;
    const priceId = body.interval === "year" ? env.STRIPE_PRICE_ID_ANNUAL : env.STRIPE_PRICE_ID_MONTHLY;
    if (!priceId) {
      return respondError("not_found");
    }
    const existing = await loadLocalBillingRow(db, workspaceId);
    const base = webBaseUrl(env);
    return runIdempotent(
      context,
      () =>
        provider.createCheckoutSession({
          workspaceId,
          customerId: existing?.stripe_customer_id ?? null,
          priceId,
          successUrl: `${base}/billing?status=success&session_id={CHECKOUT_SESSION_ID}`,
          cancelUrl: `${base}/billing?status=cancelled`,
          idempotencyKey: guard.idempotencyKey,
        }),
      { successStatus: 200 },
    );
  });
}

export async function billingReturn(
  context: AppContext,
  principal: Principal,
  executor: SqlExecutor | undefined = resolveBillingExecutor(context.env),
  { provider = resolveApiBillingProvider(context.env) }: BillingProviderOverride = {},
): Promise<Response> {
  return runBillingMemberRoute(context, principal, executor, async (ctx) => {
    const { workspaceId, db, respondError } = ctx;
    const sessionId = new URL(context.req.raw.url).searchParams.get("session_id");
    if (!sessionId) {
      return respondError("invalid_request");
    }
    const session = await provider.getCheckoutSession(sessionId);
    if (session?.subscriptionId) {
      const snapshot = await provider.getSubscription(session.subscriptionId);
      if (snapshot && snapshot.workspaceId === workspaceId) {
        await applyBillingSnapshot({
          executor: db,
          actorId: "checkout_activation",
          workspaceId,
          snapshot,
          now: new Date().toISOString(),
        });
      }
    }
    return respondBillingStatus(ctx);
  });
}

export async function billingPortal(
  context: AppContext,
  principal: Principal,
  executor: SqlExecutor | undefined = resolveBillingExecutor(context.env),
  { provider = resolveApiBillingProvider(context.env) }: BillingProviderOverride = {},
): Promise<Response> {
  return runBillingMemberRoute(
    context,
    principal,
    executor,
    async ({ env, workspaceId, db, respondError, respondJson }) => {
      const row = await loadLocalBillingRow(db, workspaceId);
      if (!row?.stripe_customer_id) {
        return respondError("not_found");
      }
      const session = await provider.createPortalSession({
        customerId: row.stripe_customer_id,
        returnUrl: `${webBaseUrl(env)}/billing`,
      });
      return respondJson(session);
    },
  );
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
  executor: SqlExecutor | undefined = resolveBillingExecutor(context.env),
  { provider = resolveApiBillingProvider(context.env) }: BillingProviderOverride = {},
): Promise<Response> {
  return runBillingMemberRoute(context, principal, executor, async ({ workspaceId, db, respondJson }) => {
    const row = await loadLocalBillingRow(db, workspaceId);
    // Free Workspaces have no Stripe customer yet, so there is nothing to list — an
    // empty history is the correct answer, not an error.
    if (!row?.stripe_customer_id) {
      return respondJson({ invoices: [] } satisfies BillingInvoiceListResponse);
    }
    const invoices = await provider.listInvoices({ customerId: row.stripe_customer_id });
    return respondJson({ invoices: invoices.map(toContractInvoice) } satisfies BillingInvoiceListResponse);
  });
}

export async function billingWebhook(
  context: AppContext,
  _principal: Principal,
  executor?: SqlExecutor,
  override: BillingProviderOverride = {},
): Promise<Response> {
  const { respondError, respondJson } = getBoundResponders(context);
  const env = context.env;
  if (!billingEnabled(env)) {
    return respondError("not_found");
  }
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
  const resolvedExecutor = executor ?? resolveBillingExecutor(env);
  if (!resolvedExecutor) {
    return respondError("database_unavailable");
  }
  try {
    const provider = override.provider ?? resolveApiBillingProvider(env);
    await processStripeSubscriptionWebhook({
      platformExecutor: rlsExecutor(resolvedExecutor, { kind: "platform" }),
      workspaceExecutor: (workspaceId) => rlsExecutor(resolvedExecutor, { kind: "workspace", workspaceId }),
      provider,
      event: verified.event,
      now: new Date().toISOString(),
    });
  } catch (error) {
    if (error instanceof StripeWebhookEventInProgressError) {
      return respondError("database_unavailable");
    }
    throw error;
  }
  return respondJson({ received: true });
}
