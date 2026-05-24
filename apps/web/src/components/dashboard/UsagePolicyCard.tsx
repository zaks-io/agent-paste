import type { UsagePolicy } from "@agent-paste/contracts";
import { formatBytes } from "../../lib/format";
import { Card, CardHeader } from "../ui/Card";

const SECONDS_PER_DAY = 24 * 60 * 60;

export function UsagePolicyCard({ policy }: { policy: UsagePolicy }) {
  const rows: ReadonlyArray<[string, string]> = [
    ["File size cap", formatBytes(policy.file_size_cap_bytes)],
    ["Artifact size cap", formatBytes(policy.artifact_size_cap_bytes)],
    ["File count cap", String(policy.file_count_cap)],
    ["Actor rate limit", `${policy.actor_rate_limit_per_minute} / min`],
    ["Default retention", `${Math.round(policy.default_ttl_seconds / SECONDS_PER_DAY)} days`],
  ];
  return (
    <Card>
      <CardHeader title="Usage policy" subtitle="Platform-controlled limits for this workspace." />
      <dl className="grid grid-cols-2 gap-y-2 text-[13px]">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-[hsl(var(--muted))]">{label}</dt>
            <dd className="font-mono tabular-nums text-right">{value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
