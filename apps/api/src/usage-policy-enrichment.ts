import type { UsagePolicyConfig } from "@agent-paste/db";
import { readWriteAllowanceRemaining, type WriteAllowanceBinding } from "./write-allowance.js";

type WriteAllowancePolicy = Pick<UsagePolicyConfig, "daily_new_artifact_allowance">;

export async function enrichUsagePolicyWithWriteAllowance<T extends WriteAllowancePolicy>(
  policy: T,
  input: { workspaceId: string; writeAllowance?: WriteAllowanceBinding | undefined },
): Promise<T & { daily_new_artifacts_remaining?: number }> {
  const remaining = await readWriteAllowanceRemaining(
    input.writeAllowance,
    input.workspaceId,
    policy.daily_new_artifact_allowance,
  );
  if (remaining === undefined) {
    return policy;
  }
  return {
    ...policy,
    daily_new_artifacts_remaining: remaining,
  };
}
