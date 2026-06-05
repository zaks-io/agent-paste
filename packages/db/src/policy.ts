import {
  DEFAULT_UPLOAD_SESSION_TTL_MS,
  EPHEMERAL_AUTO_DELETION_DAYS,
  isBillingEnabled,
  MAX_ARTIFACT_BYTES,
  PINNED_ARTIFACT_CAP,
  resolveDailyNewArtifactAllowance,
  resolveUsagePolicy,
  SECONDS_PER_DAY,
  USAGE_POLICY,
  type UsagePolicyConfig,
  type WorkspacePlan,
} from "@agent-paste/config";
import type { Workspace } from "./types.js";

export function isEphemeralWorkspace(workspace: Pick<Workspace, "claimed_at">): boolean {
  return workspace.claimed_at === null;
}

export function artifactExpiresAtFromWorkspace(
  workspace: Pick<Workspace, "auto_deletion_days">,
  publishedAt: string,
): string {
  return new Date(Date.parse(publishedAt) + workspace.auto_deletion_days * SECONDS_PER_DAY * 1000).toISOString();
}

// Ephemeral (unclaimed) artifact lifetime is a fixed server-side policy: the plan
// default, hard-capped at the one-day ephemeral ceiling. There is no client input.
export function ephemeralArtifactTtlSeconds(policy: Pick<UsagePolicyConfig, "default_ttl_seconds">): number {
  return Math.min(policy.default_ttl_seconds, EPHEMERAL_AUTO_DELETION_DAYS * SECONDS_PER_DAY);
}

export type { UsagePolicyConfig, WorkspacePlan };
export {
  DEFAULT_UPLOAD_SESSION_TTL_MS,
  isBillingEnabled,
  MAX_ARTIFACT_BYTES,
  PINNED_ARTIFACT_CAP,
  resolveUsagePolicy,
  SECONDS_PER_DAY,
  USAGE_POLICY,
};

export function usagePolicyForWorkspace(
  workspace: Pick<Workspace, "plan" | "claimed_at">,
  billingEnabled = false,
): UsagePolicyConfig {
  const base = resolveUsagePolicy({ plan: workspace.plan, billingEnabled });
  return {
    ...base,
    daily_new_artifact_allowance: resolveDailyNewArtifactAllowance({
      claimed: workspace.claimed_at != null,
      plan: workspace.plan,
      billingEnabled,
    }),
  };
}

export function autoDeletionBoundsForWorkspace(
  workspace: Pick<Workspace, "plan">,
  billingEnabled = false,
): { min: number; max: number } {
  const policy = resolveUsagePolicy({ plan: workspace.plan, billingEnabled });
  return {
    min: Math.floor(policy.min_ttl_seconds / SECONDS_PER_DAY),
    max: Math.floor(policy.max_ttl_seconds / SECONDS_PER_DAY),
  };
}

export function defaultAutoDeletionDaysForWorkspace(
  workspace: Pick<Workspace, "plan">,
  billingEnabled = false,
): number {
  return Math.floor(resolveUsagePolicy({ plan: workspace.plan, billingEnabled }).default_ttl_seconds / SECONDS_PER_DAY);
}

// Claimed-workspace artifact lifetime is the plan default. Server-side policy only;
// clients cannot request or influence it.
export function artifactTtlSecondsForUpload(policy: Pick<UsagePolicyConfig, "default_ttl_seconds">): number {
  return policy.default_ttl_seconds;
}
