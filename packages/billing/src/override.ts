import { type CommandActor, runCommand, type SqlExecutor } from "@agent-paste/commands";
import type { WorkspacePlan } from "./plan.js";

export type SetWorkspacePlanOverrideInput = {
  executor: SqlExecutor;
  actorId: string;
  workspaceId: string;
  /** `null` clears the override so Stripe state resumes control on the next sync. */
  plan: WorkspacePlan | null;
  idempotencyKey: string;
  now: string;
};

export type SetWorkspacePlanOverrideResult = {
  plan: WorkspacePlan;
  operator_override: boolean;
  plan_changed: boolean;
};

/**
 * Operator plan override (ADR 0074): writes `workspaces.plan` directly and stamps
 * `plan_operator_override_at` so reconciliation and webhooks skip the row. Passing `plan: null`
 * clears the stamp; the next reconcile/webhook then re-applies Stripe state. Audited either way.
 */
export async function setWorkspacePlanOverride(
  input: SetWorkspacePlanOverrideInput,
): Promise<SetWorkspacePlanOverrideResult> {
  const actor: CommandActor = {
    type: "platform",
    id: input.actorId,
    workspaceId: input.workspaceId,
  };

  const command = await runCommand({
    executor: input.executor,
    actor,
    operation: "billing.set_plan_override",
    idempotencyKey: input.idempotencyKey,
    workspaceId: input.workspaceId,
    now: input.now,
    handler: async (tx) => {
      const workspace = await tx.query<{ plan: WorkspacePlan }>(
        `select plan from workspaces where id = $1 for update`,
        [input.workspaceId],
      );
      const previousPlan = workspace.rows[0]?.plan;
      if (!previousPlan) {
        throw new Error("workspace_not_found");
      }

      if (input.plan === null) {
        await tx.query(`update workspaces set plan_operator_override_at = null, updated_at = $2 where id = $1`, [
          input.workspaceId,
          input.now,
        ]);
        return {
          result: { plan: previousPlan, operator_override: false, plan_changed: false },
          audit: [
            buildAudit(input, {
              previousPlan,
              plan: previousPlan,
              source: "operator_override_cleared",
            }),
          ],
        };
      }

      await tx.query(`update workspaces set plan = $2, plan_operator_override_at = $3, updated_at = $3 where id = $1`, [
        input.workspaceId,
        input.plan,
        input.now,
      ]);
      return {
        result: { plan: input.plan, operator_override: true, plan_changed: previousPlan !== input.plan },
        audit: [
          buildAudit(input, {
            previousPlan,
            plan: input.plan,
            source: "operator_override",
          }),
        ],
      };
    },
  });

  return command.result;
}

function buildAudit(
  input: SetWorkspacePlanOverrideInput,
  details: { previousPlan: WorkspacePlan; plan: WorkspacePlan; source: string },
) {
  return {
    workspaceId: input.workspaceId,
    actorType: "platform" as const,
    actorId: input.actorId,
    action: "workspace.plan.updated",
    targetType: "workspace",
    targetId: input.workspaceId,
    details: {
      previous_plan: details.previousPlan,
      plan: details.plan,
      source: details.source,
    },
    occurredAt: input.now,
  };
}
