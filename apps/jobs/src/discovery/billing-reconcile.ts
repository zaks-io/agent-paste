import { createNoopBillingProvider, createStripeBillingProvider, runBillingReconciliation } from "@agent-paste/billing";
import type { SqlExecutor } from "@agent-paste/db";
import { CRON_BILLING_RECONCILE } from "../constants.js";
import { withPlatformScope } from "../db.js";
import type { Env } from "../env.js";
import { billingEnabled } from "../env.js";
import { logOp, logOpError } from "../op-log.js";
import type { SweepResult } from "./types.js";

export async function runBillingReconcileDiscovery(executor: SqlExecutor, env: Env, now: string): Promise<SweepResult> {
  if (!billingEnabled(env)) {
    return { discovered: 0, enqueued: 0, cap_hit: false };
  }

  const provider = resolveBillingProvider(env);
  if (!provider) {
    logOpError("cron.billing_reconcile.provider_unavailable", { cron: CRON_BILLING_RECONCILE });
    return { discovered: 0, enqueued: 0, cap_hit: false };
  }

  try {
    const result = await runBillingReconciliation({
      executor: withPlatformScope(executor),
      provider,
      now,
      log: (event, fields) => logOp(event, fields),
    });
    logOp("cron.billing_reconcile", {
      discovered: result.discovered,
      synced: result.synced,
      drift_events: result.drift_events,
      skipped_operator_override: result.skipped_operator_override,
      cap_hit: result.cap_hit,
    });
    return {
      discovered: result.discovered,
      enqueued: result.synced,
      cap_hit: result.cap_hit,
    };
  } catch (error) {
    logOpError("cron.billing_reconcile.failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { discovered: 0, enqueued: 0, cap_hit: false };
  }
}

function resolveBillingProvider(env: Env) {
  if (env.STRIPE_SECRET_KEY) {
    return createStripeBillingProvider({ secretKey: env.STRIPE_SECRET_KEY });
  }
  return createNoopBillingProvider();
}
