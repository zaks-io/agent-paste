import {
  DAILY_NEW_ARTIFACT_ALLOWANCE_EPHEMERAL,
  resolveUsagePolicy,
  SECONDS_PER_DAY,
  type UsagePolicyConfig,
} from "@agent-paste/config";

const BYTES_PER_MB = 1024 * 1024;

function formatMegabytes(bytes: number): string {
  return `${bytes / BYTES_PER_MB} MB`;
}

function formatTtlWindow(policy: UsagePolicyConfig): string {
  const defaultDays = policy.default_ttl_seconds / SECONDS_PER_DAY;
  const maxDays = policy.max_ttl_seconds / SECONDS_PER_DAY;
  return `${defaultDays}d default, ${maxDays}d max`;
}

function formatLiveArtifacts(policy: UsagePolicyConfig, ephemeral = false): string {
  if (ephemeral) {
    return "low-cap unclaimed Workspace";
  }
  return String(policy.live_artifacts_cap);
}

function formatLiveUpdates(policy: UsagePolicyConfig): string {
  return policy.live_update_enabled ? "Yes" : "No";
}

function policyTableRow(
  planLabel: string,
  policy: UsagePolicyConfig,
  dailyAllowance: number,
  options?: { ephemeral?: boolean; ttlLabel?: string },
): string[] {
  const ephemeral = options?.ephemeral ?? false;
  const ttl = options?.ttlLabel ?? (ephemeral ? "24h auto-delete" : formatTtlWindow(policy));
  return [
    planLabel,
    String(dailyAllowance),
    formatMegabytes(policy.file_size_cap_bytes),
    formatMegabytes(policy.artifact_size_cap_bytes),
    ttl,
    formatLiveArtifacts(policy, ephemeral),
    formatLiveUpdates(policy),
  ];
}

export const BILLING_PLANS_TABLE_COLUMNS = [
  "Plan",
  "Daily new Artifacts",
  "File cap",
  "Artifact and Bundle cap",
  "TTL",
  "Live Artifacts",
  "Live Updates",
] as const;

/** Rows for the `/docs/billing` plans table (Ephemeral, Free, Pro). */
export function billingPlansTableRows(): string[][] {
  const free = resolveUsagePolicy({ plan: "free", billingEnabled: true });
  const pro = resolveUsagePolicy({ plan: "pro", billingEnabled: true });
  const ephemeralPolicy = resolveUsagePolicy({ billingEnabled: false });

  return [
    policyTableRow("Ephemeral", ephemeralPolicy, DAILY_NEW_ARTIFACT_ALLOWANCE_EPHEMERAL, {
      ephemeral: true,
      ttlLabel: "24h auto-delete",
    }),
    policyTableRow("Free", free, free.daily_new_artifact_allowance),
    policyTableRow("Pro", pro, pro.daily_new_artifact_allowance),
  ];
}

export type PricingComparisonRow = {
  feature: string;
  free: string;
  pro: string;
};

/** Free vs Pro rows for the public `/pricing` comparison table. */
export function pricingComparisonRows(): PricingComparisonRow[] {
  const free = resolveUsagePolicy({ plan: "free", billingEnabled: true });
  const pro = resolveUsagePolicy({ plan: "pro", billingEnabled: true });

  return [
    {
      feature: "Daily new Artifacts",
      free: String(free.daily_new_artifact_allowance),
      pro: String(pro.daily_new_artifact_allowance),
    },
    {
      feature: "File cap",
      free: formatMegabytes(free.file_size_cap_bytes),
      pro: formatMegabytes(pro.file_size_cap_bytes),
    },
    {
      feature: "Artifact and Bundle cap",
      free: formatMegabytes(free.artifact_size_cap_bytes),
      pro: formatMegabytes(pro.artifact_size_cap_bytes),
    },
    {
      feature: "TTL",
      free: formatTtlWindow(free),
      pro: formatTtlWindow(pro),
    },
    {
      feature: "Live Artifacts",
      free: String(free.live_artifacts_cap),
      pro: String(pro.live_artifacts_cap),
    },
    {
      feature: "Live Updates",
      free: formatLiveUpdates(free),
      pro: formatLiveUpdates(pro),
    },
  ];
}
