import type { UsagePolicy } from "@agent-paste/contracts";
import { formatBytes } from "../../lib/format";
import { SectionLabel } from "../ui/Card";

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
      <dl className="border-t border-[hsl(var(--rule))]">
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="flex items-center justify-between border-b border-[hsl(var(--rule))] py-2.5 pl-3 pr-3"
          >
            <dt className="text-[12.5px] text-[hsl(var(--subtle))]">{label}</dt>
            <dd className="font-mono text-[12.5px] tabular-nums text-[hsl(var(--foreground))]">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
