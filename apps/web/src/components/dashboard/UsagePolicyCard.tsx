import type { UsagePolicy } from "@agent-paste/contracts";
import { SectionLabel } from "@agent-paste/ui";
import { formatBytes } from "../../lib/format";

const SECONDS_PER_DAY = 24 * 60 * 60;

/* A mono spec sheet. Hairline rows, no card. The plumbing, deliberately quiet. */
export function UsagePolicyCard({ policy }: { policy: UsagePolicy }) {
  const rows: ReadonlyArray<[string, string]> = [
    ["File cap", formatBytes(policy.file_size_cap_bytes)],
    ["Artifact cap", formatBytes(policy.artifact_size_cap_bytes)],
    ["File count", String(policy.file_count_cap)],
    ["Rate limit", `${policy.actor_rate_limit_per_minute}/min`],
    ["Retention", `${Math.round(policy.default_ttl_seconds / SECONDS_PER_DAY)}d`],
    ["Daily writes", String(policy.daily_new_artifact_allowance)],
  ];
  return (
    <section>
      <SectionLabel className="mb-4">Policy</SectionLabel>
      <dl className="border-t border-rule">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between border-b border-rule py-2 pl-3 pr-3">
            <dt className="text-mono text-subtle">{label}</dt>
            <dd className="font-mono text-mono tabular-nums text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
