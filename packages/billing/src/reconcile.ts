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

type ReconcileContext = {
  executor: SqlExecutor;
  provider: BillingProvider;
  now: string;
  log: BillingDriftLogger;
  remoteBySubscription: Map<string, BillingSubscriptionSnapshot>;
};

/** Outcome counters for a single applied snapshot. Drift is reported separately. */
type SweepCounters = {
  synced: number;
  drift_events: number;
  skipped_operator_override: number;
};

const EMPTY_COUNTERS: SweepCounters = { synced: 0, drift_events: 0, skipped_operator_override: 0 };

export async function runBillingReconciliation(input: {
  executor: SqlExecutor;
  provider: BillingProvider;
  now: string;
  log?: BillingDriftLogger;
  cap?: number;
}): Promise<BillingReconciliationResult> {
  const cap = input.cap ?? BILLING_RECONCILE_SWEEP_CAP;
  const remoteBySubscription = await loadRemoteSnapshots(input.provider);
  const localTargets = await listLocalBillingTargets(input.executor, cap + 1);
  const cap_hit = localTargets.length > cap;
  const batch = localTargets.slice(0, cap);

  const ctx: ReconcileContext = {
    executor: input.executor,
    provider: input.provider,
    now: input.now,
    log: input.log ?? (() => {}),
    remoteBySubscription,
  };

  const totals = { ...EMPTY_COUNTERS };
  for (const target of batch) {
    addCounters(totals, await reconcileLocalTarget(ctx, target));
  }
  for (const remote of remoteBySubscription.values()) {
    if (batch.some((row) => row.workspace_id === remote.workspaceId)) {
      continue;
    }
    addCounters(totals, await reconcileOrphanRemote(ctx, remote));
  }

  return {
    discovered: batch.length,
    synced: totals.synced,
    drift_events: totals.drift_events,
    skipped_operator_override: totals.skipped_operator_override,
    cap_hit,
  };
}

function addCounters(totals: SweepCounters, delta: SweepCounters): void {
  totals.synced += delta.synced;
  totals.drift_events += delta.drift_events;
  totals.skipped_operator_override += delta.skipped_operator_override;
}

async function reconcileLocalTarget(ctx: ReconcileContext, target: LocalBillingTarget): Promise<SweepCounters> {
  const remote =
    ctx.remoteBySubscription.get(target.stripe_subscription_id) ??
    (await ctx.provider.getSubscription(target.stripe_subscription_id));
  if (!remote) {
    return EMPTY_COUNTERS;
  }
  const local = await loadLocalBillingRow(ctx.executor, target.workspace_id);
  if (!local) {
    return EMPTY_COUNTERS;
  }
  if (local.plan_operator_override_at) {
    return { ...EMPTY_COUNTERS, skipped_operator_override: 1 };
  }

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
      plan: planFromSubscriptionStatus(remote.status),
      stripe_customer_id: remote.stripeCustomerId,
      stripe_subscription_id: remote.stripeSubscriptionId,
      subscription_status: remote.status,
      current_period_end: remote.currentPeriodEnd,
      price_interval: remote.priceInterval,
    },
  });
  let drift_events = 0;
  if (drift.length > 0) {
    drift_events = drift.length;
    logBillingDrift(ctx.log, drift);
  }

  const applied = await applySnapshotCounters(ctx, target.workspace_id, remote);
  return { ...applied, drift_events };
}

async function reconcileOrphanRemote(
  ctx: ReconcileContext,
  remote: BillingSubscriptionSnapshot,
): Promise<SweepCounters> {
  const local = await loadLocalBillingRow(ctx.executor, remote.workspaceId);
  if (local?.stripe_subscription_id) {
    return EMPTY_COUNTERS;
  }
  return applySnapshotCounters(ctx, remote.workspaceId, remote);
}

async function applySnapshotCounters(
  ctx: ReconcileContext,
  workspaceId: string,
  snapshot: BillingSubscriptionSnapshot,
): Promise<SweepCounters> {
  const result = await applyBillingSnapshot({
    executor: ctx.executor,
    actorId: "billing_reconcile",
    workspaceId,
    snapshot,
    now: ctx.now,
  });
  if (result.skipped_operator_override) {
    return { ...EMPTY_COUNTERS, skipped_operator_override: 1 };
  }
  if (result.applied) {
    return { ...EMPTY_COUNTERS, synced: 1 };
  }
  return EMPTY_COUNTERS;
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
