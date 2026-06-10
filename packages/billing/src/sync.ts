import { type CommandActor, runCommand, type SqlExecutor } from "@agent-paste/commands";
import type { SubscriptionStatus, WorkspacePlan } from "./plan.js";
import { billingSyncIdempotencyKey, planFromSubscriptionStatus } from "./plan.js";
import type { BillingSubscriptionSnapshot } from "./provider.js";

export type BillingSyncActorId = "billing_reconcile" | "checkout_activation" | "stripe_webhook";

export type ApplyBillingSnapshotInput = {
  executor: SqlExecutor;
  actorId: BillingSyncActorId;
  workspaceId: string;
  snapshot: BillingSubscriptionSnapshot;
  now: string;
};

export type ApplyBillingSnapshotResult = {
  applied: boolean;
  /** True when an identical retry replayed the stored completion instead of executing. */
  replayed: boolean;
  skipped_operator_override: boolean;
  previous_plan: WorkspacePlan;
  plan: WorkspacePlan;
  plan_changed: boolean;
};

type BillingSyncCommandResult = Omit<ApplyBillingSnapshotResult, "replayed">;

export async function applyBillingSnapshot(input: ApplyBillingSnapshotInput): Promise<ApplyBillingSnapshotResult> {
  const actor: CommandActor = {
    type: "system",
    id: input.actorId,
    workspaceId: input.workspaceId,
  };
  const targetPlan = planFromSubscriptionStatus(input.snapshot.status);
  const idempotencyKey = billingSyncIdempotencyKey({
    subscriptionId: input.snapshot.stripeSubscriptionId,
    status: input.snapshot.status,
    currentPeriodEnd: input.snapshot.currentPeriodEnd,
    appliedAt: input.now,
  });

  const command = await runCommand<BillingSyncCommandResult>({
    executor: input.executor,
    actor,
    operation: "billing.sync_subscription",
    idempotencyKey,
    workspaceId: input.workspaceId,
    now: input.now,
    handler: async (tx) => {
      const workspace = await tx.query<{
        plan: WorkspacePlan;
        plan_operator_override_at: string | null;
      }>(
        `select plan, plan_operator_override_at
         from workspaces
         where id = $1
         for update`,
        [input.workspaceId],
      );
      const row = workspace.rows[0];
      if (!row) {
        throw new Error("workspace_not_found");
      }
      if (row.plan_operator_override_at) {
        return {
          result: {
            applied: false,
            skipped_operator_override: true,
            previous_plan: row.plan,
            plan: row.plan,
            plan_changed: false,
          },
        };
      }

      const previousPlan = row.plan;
      await tx.query(
        `insert into workspace_billing (
           workspace_id,
           stripe_customer_id,
           stripe_subscription_id,
           subscription_status,
           current_period_end,
           price_interval,
           synced_at,
           updated_at
         )
         values ($1, $2, $3, $4, $5, $6, $7, $7)
         on conflict (workspace_id) do update
         set stripe_customer_id = excluded.stripe_customer_id,
             stripe_subscription_id = excluded.stripe_subscription_id,
             subscription_status = excluded.subscription_status,
             current_period_end = excluded.current_period_end,
             price_interval = excluded.price_interval,
             synced_at = excluded.synced_at,
             updated_at = excluded.updated_at`,
        [
          input.workspaceId,
          input.snapshot.stripeCustomerId,
          input.snapshot.stripeSubscriptionId,
          input.snapshot.status,
          input.snapshot.currentPeriodEnd,
          input.snapshot.priceInterval,
          input.now,
        ],
      );

      const planChanged = previousPlan !== targetPlan;
      if (planChanged) {
        await tx.query(
          `update workspaces set plan = $2, updated_at = $3
           where id = $1 and plan_operator_override_at is null`,
          [input.workspaceId, targetPlan, input.now],
        );
      }

      const audit = planChanged
        ? [
            {
              workspaceId: input.workspaceId,
              actorType: "system" as const,
              actorId: input.actorId,
              action: "workspace.plan.updated",
              targetType: "workspace",
              targetId: input.workspaceId,
              details: {
                previous_plan: previousPlan,
                plan: targetPlan,
                subscription_status: input.snapshot.status,
                source: input.actorId,
              },
              occurredAt: input.now,
            },
          ]
        : [];

      return {
        result: {
          applied: true,
          skipped_operator_override: false,
          previous_plan: previousPlan,
          plan: targetPlan,
          plan_changed: planChanged,
        },
        audit,
      };
    },
  });

  return { ...command.result, replayed: command.isReplay };
}

export type LocalBillingRow = {
  workspace_id: string;
  plan: WorkspacePlan;
  plan_operator_override_at: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  subscription_status: SubscriptionStatus | null;
  current_period_end: string | null;
  price_interval: "month" | "year" | null;
};

type RawLocalBillingRow = Omit<LocalBillingRow, "current_period_end"> & {
  current_period_end: string | Date | null;
};

/**
 * Drivers disagree on timestamptz output (postgres-js yields pg text, PGlite a
 * Date object); normalize to the ISO-8601 shape Stripe snapshots use so drift
 * detection compares instants, not driver formatting.
 */
function normalizeLocalBillingRow(row: RawLocalBillingRow): LocalBillingRow {
  return {
    ...row,
    current_period_end: row.current_period_end === null ? null : new Date(row.current_period_end).toISOString(),
  };
}

export async function loadLocalBillingRow(executor: SqlExecutor, workspaceId: string): Promise<LocalBillingRow | null> {
  const result = await executor.query<RawLocalBillingRow>(
    `select
       w.id as workspace_id,
       w.plan,
       w.plan_operator_override_at,
       b.stripe_customer_id,
       b.stripe_subscription_id,
       b.subscription_status,
       b.current_period_end,
       b.price_interval
     from workspaces w
     left join workspace_billing b on b.workspace_id = w.id
     where w.id = $1`,
    [workspaceId],
  );
  const row = result.rows[0];
  return row ? normalizeLocalBillingRow(row) : null;
}

export async function loadLocalBillingRowBySubscription(
  executor: SqlExecutor,
  subscriptionId: string,
): Promise<LocalBillingRow | null> {
  const result = await executor.query<RawLocalBillingRow>(
    `select
       w.id as workspace_id,
       w.plan,
       w.plan_operator_override_at,
       b.stripe_customer_id,
       b.stripe_subscription_id,
       b.subscription_status,
       b.current_period_end,
       b.price_interval
     from workspace_billing b
     inner join workspaces w on w.id = b.workspace_id
     where b.stripe_subscription_id = $1`,
    [subscriptionId],
  );
  const row = result.rows[0];
  return row ? normalizeLocalBillingRow(row) : null;
}
