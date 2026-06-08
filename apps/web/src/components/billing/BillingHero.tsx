import type { BillingStatusResponse } from "@agent-paste/contracts";
import { Badge, type BadgeTone } from "@agent-paste/ui";
import { formatBillingDate } from "./format";

type StatusChip = { tone: BadgeTone; label: string; pulse: boolean };

function statusChip(status: BillingStatusResponse): StatusChip {
  if (status.operator_override) {
    return { tone: "accent", label: "Operator override", pulse: false };
  }
  const sub = status.subscription;
  if (!sub) {
    return { tone: "neutral", label: "No subscription", pulse: false };
  }
  switch (sub.status) {
    case "active":
    case "trialing":
      return { tone: "success", label: sub.status === "trialing" ? "Trialing" : "Active", pulse: true };
    case "past_due":
    case "unpaid":
      return { tone: "warning", label: "Past due", pulse: false };
    case "canceled":
    case "incomplete_expired":
      return { tone: "destructive", label: "Canceled", pulse: false };
    default:
      return { tone: "neutral", label: sub.status, pulse: false };
  }
}

function heroDetail(status: BillingStatusResponse): string {
  if (status.operator_override) {
    return "Set by an operator. Stripe sync is paused for this workspace.";
  }
  if (status.plan === "pro") {
    return "Renews automatically. Manage your card and receipts in the portal.";
  }
  return "Your daily write allowance applies. Upgrade for the Pro ceiling.";
}

type RailItem = { label: string; value: string };

function railItems(status: BillingStatusResponse): RailItem[] {
  const items: RailItem[] = [
    { label: "Writes / day", value: status.daily_new_artifact_allowance.toLocaleString("en") },
  ];
  if (status.daily_new_artifacts_remaining !== undefined) {
    items.push({ label: "Remaining today", value: status.daily_new_artifacts_remaining.toLocaleString("en") });
  }
  items.push({ label: "Renews", value: formatBillingDate(status.subscription?.current_period_end) });
  return items;
}

export function BillingHero({ status }: { status: BillingStatusResponse }) {
  const chip = statusChip(status);
  const planLabel = status.plan === "pro" ? "Pro" : "Free";
  return (
    <section className="flex flex-col gap-7 border-b border-[hsl(var(--rule))] pb-8 lg:flex-row lg:items-start lg:justify-between lg:gap-12">
      <div className="flex items-start gap-5">
        {/* Top-align the plan figure with the "CURRENT PLAN" eyebrow. The display face
            carries empty space above its cap-height, so trim it up a touch. */}
        <span className="hero-figure text-[hsl(var(--foreground))] leading-[0.78] mt-[-0.04em]">{planLabel}</span>
        <div className="flex flex-col gap-[7px]">
          <p className="eyebrow">Current plan</p>
          <p className="flex items-center gap-3 font-display text-[var(--text-h2)] font-semibold leading-none tracking-[-0.01em]">
            <Badge tone={chip.tone} dot pulse={chip.pulse}>
              {chip.label}
            </Badge>
          </p>
          <p className="m-0 max-w-[42ch] font-mono text-[12px] text-[hsl(var(--subtle))]">{heroDetail(status)}</p>
        </div>
      </div>

      <dl className="flex flex-wrap gap-x-9 gap-y-4 lg:justify-end">
        {railItems(status).map((item) => (
          <div key={item.label} className="grid gap-1.5">
            <dt className="eyebrow">{item.label}</dt>
            <dd className="m-0 font-mono text-[18px] font-medium leading-none tabular-nums text-[hsl(var(--foreground))]">
              {item.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
