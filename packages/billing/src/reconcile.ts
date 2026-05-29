import type { SqlExecutor } from "@agent-paste/commands";
import { type BillingDriftLogger, detectBillingDrift, logBillingDrift } from "./drift.js";
import { planFromSubscriptionStatus } from "./plan.js";
import type { BillingProvider, BillingSubscriptionSnapshot } from "./provider.js";
import { applyBillingSnapshot, loadLocalBillingRow } from "./sync.js";

export const BILLING_RECONCILE_SWEEP_CAP = 500;

export type BillingReconciliationResult = {
  discovered: number;
  synced: number;
  drift_events: number;
  skipped_operator_override: number;
  cap_hit: boolean;
};

type LocalBillingTarget = {
  workspace_id: string;
  stripe_subscription_id: string;
};

export async function runBillingReconciliation(input: {
  executor: SqlExecutor;
  provider: BillingProvider;
  now: string;
  log?: BillingDriftLogger;
  cap?: number;
}): Promise<BillingReconciliationResult> {
  const cap = input.cap ?? BILLING_RECONCILE_SWEEP_CAP;
  const log = input.log ?? (() => {});
  const remoteBySubscription = await loadRemoteSnapshots(input.provider);
  const localTargets = await listLocalBillingTargets(input.executor, cap + 1);
  const cap_hit = localTargets.length > cap;
  const batch = localTargets.slice(0, cap);

  let synced = 0;
  let drift_events = 0;
  let skipped_operator_override = 0;

  for (const target of batch) {
    const remote =
      remoteBySubscription.get(target.stripe_subscription_id) ??
      (await input.provider.getSubscription(target.stripe_subscription_id));
    if (!remote) {
      continue;
    }
    const local = await loadLocalBillingRow(input.executor, target.workspace_id);
    if (!local) {
      continue;
    }
    if (local.plan_operator_override_at) {
      skipped_operator_override += 1;
      continue;
    }

    const remotePlan = planFromSubscriptionStatus(remote.status);
    const drift = detectBillingDrift({
      workspaceId: target.workspace_id,
      local: {
        plan: local.plan,
        stripe_customer_id: local.stripe_customer_id,
        stripe_subscription_id: local.stripe_subscription_id,
        subscription_status: local.subscription_status,
        current_period_end: local.current_period_end,
        price_interval: local.price_interval,
      },
      remote: {
        plan: remotePlan,
        stripe_customer_id: remote.stripeCustomerId,
        stripe_subscription_id: remote.stripeSubscriptionId,
        subscription_status: remote.status,
        current_period_end: remote.currentPeriodEnd,
        price_interval: remote.priceInterval,
      },
    });
    if (drift.length > 0) {
      drift_events += drift.length;
      logBillingDrift(log, drift);
    }

    const result = await applyBillingSnapshot({
      executor: input.executor,
      actorId: "billing_reconcile",
      workspaceId: target.workspace_id,
      snapshot: remote,
      now: input.now,
    });
    if (result.skipped_operator_override) {
      skipped_operator_override += 1;
      continue;
    }
    if (result.applied) {
      synced += 1;
    }
  }

  for (const remote of remoteBySubscription.values()) {
    if (batch.some((row) => row.workspace_id === remote.workspaceId)) {
      continue;
    }
    const local = await loadLocalBillingRow(input.executor, remote.workspaceId);
    if (!local?.stripe_subscription_id) {
      const result = await applyBillingSnapshot({
        executor: input.executor,
        actorId: "billing_reconcile",
        workspaceId: remote.workspaceId,
        snapshot: remote,
        now: input.now,
      });
      if (result.skipped_operator_override) {
        skipped_operator_override += 1;
      } else if (result.applied) {
        synced += 1;
      }
    }
  }

  return {
    discovered: batch.length,
    synced,
    drift_events,
    skipped_operator_override,
    cap_hit,
  };
}

async function loadRemoteSnapshots(provider: BillingProvider): Promise<Map<string, BillingSubscriptionSnapshot>> {
  const snapshots = await provider.listReconciliationSubscriptions();
  const map = new Map<string, BillingSubscriptionSnapshot>();
  for (const snapshot of snapshots) {
    map.set(snapshot.stripeSubscriptionId, snapshot);
  }
  return map;
}

async function listLocalBillingTargets(executor: SqlExecutor, limit: number): Promise<LocalBillingTarget[]> {
  const result = await executor.query<LocalBillingTarget>(
    `select workspace_id, stripe_subscription_id
     from workspace_billing
     where stripe_subscription_id is not null
     order by updated_at asc
     limit $1`,
    [limit],
  );
  return result.rows;
}
