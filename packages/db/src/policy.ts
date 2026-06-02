import {
  DEFAULT_UPLOAD_SESSION_TTL_MS,
  EPHEMERAL_AUTO_DELETION_DAYS,
  isBillingEnabled,
  MAX_ARTIFACT_BYTES,
  PINNED_ARTIFACT_CAP,
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

export function ephemeralArtifactTtlSeconds(
  requestedTtlSeconds: number | undefined,
  policy: Pick<UsagePolicyConfig, "default_ttl_seconds" | "min_ttl_seconds" | "max_ttl_seconds">,
): number {
  const ephemeralCap = EPHEMERAL_AUTO_DELETION_DAYS * SECONDS_PER_DAY;
  const ttlSeconds = requestedTtlSeconds ?? Math.min(policy.default_ttl_seconds, ephemeralCap);
  if (ttlSeconds < policy.min_ttl_seconds || ttlSeconds > ephemeralCap) {
    throw new Error("invalid_ttl_seconds");
  }
  return ttlSeconds;
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

export function usagePolicyForWorkspace(workspace: Pick<Workspace, "plan">, billingEnabled = false): UsagePolicyConfig {
  return resolveUsagePolicy({ plan: workspace.plan, billingEnabled });
}

export function autoDeletionBoundsForWorkspace(
  workspace: Pick<Workspace, "plan">,
  billingEnabled = false,
): { min: number; max: number } {
  const policy = usagePolicyForWorkspace(workspace, billingEnabled);
  return {
    min: Math.floor(policy.min_ttl_seconds / SECONDS_PER_DAY),
    max: Math.floor(policy.max_ttl_seconds / SECONDS_PER_DAY),
  };
}

export function defaultAutoDeletionDaysForWorkspace(
  workspace: Pick<Workspace, "plan">,
  billingEnabled = false,
): number {
  return Math.floor(usagePolicyForWorkspace(workspace, billingEnabled).default_ttl_seconds / SECONDS_PER_DAY);
}

export function artifactTtlSecondsForUpload(
  requestedTtlSeconds: number | undefined,
  policy: Pick<UsagePolicyConfig, "default_ttl_seconds" | "min_ttl_seconds" | "max_ttl_seconds">,
): number {
  const ttlSeconds = requestedTtlSeconds ?? policy.default_ttl_seconds;
  if (ttlSeconds < policy.min_ttl_seconds || ttlSeconds > policy.max_ttl_seconds) {
    throw new Error("invalid_ttl_seconds");
  }
  return ttlSeconds;
}
