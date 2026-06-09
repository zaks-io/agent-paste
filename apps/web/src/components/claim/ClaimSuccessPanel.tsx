import type { UsagePolicy } from "@agent-paste/contracts";
import { PLANS } from "@agent-paste/plans";
import { Link } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { cn } from "../../lib/cn";
import { Button } from "../ui/Button";
import { Card, CardHeader, SectionLabel } from "../ui/Card";

const SECONDARY_LINK =
  "inline-flex h-[40px] items-center justify-center rounded-[var(--radius-sm)] border border-[hsl(var(--rule-strong))] " +
  "px-[18px] text-[14px] font-medium text-[hsl(var(--foreground))] transition-colors hover:bg-[hsl(var(--surface-2))]";

const SECONDS_PER_DAY = 24 * 60 * 60;
/** Unclaimed ephemeral tier (ADR 0056); display-only comparison against claimed free. */
const EPHEMERAL_DAILY_WRITES = 20;
const EPHEMERAL_RETENTION_DAYS = 1;

export type ClaimSuccessPanelProps = {
  artifactCount: number;
  artifactDestination: string;
  billingEnabled: boolean;
  usagePolicy: UsagePolicy;
  onViewArtifacts: () => void;
};

function retentionDays(seconds: number): number {
  return Math.round(seconds / SECONDS_PER_DAY);
}

function freeLimitRows(policy: UsagePolicy): ReadonlyArray<[string, string]> {
  const defaultDays = retentionDays(policy.default_ttl_seconds);
  const maxDays = retentionDays(policy.max_ttl_seconds);
  return [
    ["Plan", "Free (claimed)"],
    ["Daily writes", `${policy.daily_new_artifact_allowance} new artifacts`],
    ["Retention", `${defaultDays}d default · ${maxDays}d max`],
    ["Script execution", "Enabled"],
    ["Reads", "Unlimited — never gated"],
  ];
}

const CHANGES = [
  {
    label: "Write allowance",
    detail: (free: number) => `Raised from ${EPHEMERAL_DAILY_WRITES} to ${free} new artifacts per day`,
  },
  {
    label: "Retention",
    detail: (maxDays: number) => `Up to ${maxDays} days instead of ${EPHEMERAL_RETENTION_DAYS} day while unclaimed`,
  },
  {
    label: "Script execution",
    detail: () => "JavaScript and interactive HTML now run — ephemeral content stayed inert",
  },
  {
    label: "Reads",
    detail: () => "Share links stay free for your audience — only writes and durability are tiered",
  },
] as const;

export function ClaimSuccessPanel({
  artifactCount,
  artifactDestination,
  billingEnabled,
  usagePolicy,
  onViewArtifacts,
}: ClaimSuccessPanelProps) {
  const maxRetentionDays = retentionDays(usagePolicy.max_ttl_seconds);
  const viewLabel = artifactCount === 1 ? "View artifact" : `View ${artifactCount} artifacts`;

  return (
    <div className="grid gap-5">
      <Card className="border-[hsl(var(--accent)/0.3)] bg-[hsl(var(--accent-tint))]">
        <CardHeader
          title="Content claimed"
          subtitle={`Reparented ${artifactCount} artifact${artifactCount === 1 ? "" : "s"} into your Personal Workspace on the free plan.`}
        />
        <div className="flex flex-wrap items-center gap-2.5">
          <Button size="lg" onClick={onViewArtifacts}>
            {viewLabel}
          </Button>
          {billingEnabled ? (
            <Link to="/billing" className={SECONDARY_LINK}>
              Upgrade to Pro
            </Link>
          ) : null}
        </div>
      </Card>

      <Card>
        <SectionLabel className="mb-4">What changed</SectionLabel>
        <ul className="grid list-none gap-3 p-0">
          {CHANGES.map((item) => (
            <li key={item.label} className="flex items-start gap-2.5 text-[13px] text-[hsl(var(--muted))]">
              <Check aria-hidden size={14} strokeWidth={2.25} className="mt-0.5 shrink-0 text-[hsl(var(--accent))]" />
              <span>
                <span className="font-medium text-[hsl(var(--foreground))]">{item.label}.</span>{" "}
                {item.label === "Write allowance"
                  ? item.detail(usagePolicy.daily_new_artifact_allowance)
                  : item.label === "Retention"
                    ? item.detail(maxRetentionDays)
                    : item.detail()}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <SectionLabel className="mb-4">Your free limits</SectionLabel>
        <dl className="border-t border-[hsl(var(--rule))]">
          {freeLimitRows(usagePolicy).map(([label, value]) => (
            <div
              key={label}
              className="flex items-center justify-between border-b border-[hsl(var(--rule))] py-2.5 pl-3 pr-3"
            >
              <dt className="text-[12.5px] text-[hsl(var(--subtle))]">{label}</dt>
              <dd className="font-mono text-[12.5px] tabular-nums text-[hsl(var(--foreground))]">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>

      {billingEnabled ? (
        <Card>
          <CardHeader
            title="Need more durability?"
            subtitle={`Pro raises your daily write ceiling to ${PLANS.pro.dailyNewArtifactAllowance.toLocaleString("en")} and extends retention up to 90 days. Reads stay free either way.`}
          />
          <Link to="/billing" className={cn(SECONDARY_LINK, "h-[35px] px-[15px] text-[13.5px]")}>
            Compare plans and upgrade
          </Link>
        </Card>
      ) : (
        <Card>
          <CardHeader
            title="Self-hosted deployment"
            subtitle="Billing isn't enabled here, so paid upgrades aren't available. You keep the free write allowance and full read access with no Stripe setup required."
          />
        </Card>
      )}

      <p className="font-mono text-[11px] text-[hsl(var(--faint))]">
        Next: {viewLabel.toLowerCase()} at {artifactDestination}
      </p>
    </div>
  );
}
