import type { BillingStatusResponse } from "@agent-paste/contracts";
import { useState } from "react";
import { cn } from "../../lib/cn";
import { openPortalFn } from "../../rpc/web-mutations";
import { Button } from "../ui/Button";
import { SectionLabel } from "../ui/Card";
import { errorToast, useToast } from "../ui/toast-context";
import { BillingNote } from "./BillingNote";
import { formatBillingDate } from "./format";

function intervalLabel(value: "month" | "year" | null): string {
  if (value === "month") return "Monthly";
  if (value === "year") return "Annual";
  return "—";
}

function statusLabel(status: BillingStatusResponse): string {
  if (status.subscription) return status.subscription.status;
  return status.operator_override ? "operator override" : "no subscription";
}

export function SubscriptionPanel({ status }: { status: BillingStatusResponse }) {
  const { push } = useToast();
  const [pending, setPending] = useState(false);
  const sub = status.subscription;
  const pastDue = sub?.status === "past_due" || sub?.status === "unpaid";

  async function manage() {
    if (pending) return;
    setPending(true);
    try {
      const result = await openPortalFn();
      if (result.error) {
        push(errorToast("Couldn't open the billing portal", result.error));
        return;
      }
      window.location.assign(result.data.url);
    } finally {
      setPending(false);
    }
  }

  const rows: ReadonlyArray<[string, string]> = [
    ["Status", statusLabel(status)],
    ["Interval", intervalLabel(sub?.price_interval ?? null)],
    ["Current period ends", formatBillingDate(sub?.current_period_end)],
    ["Workspace plan", status.plan],
  ];

  return (
    <aside>
      <SectionLabel className="mb-[18px]">Subscription</SectionLabel>
      <dl className="grid">
        {rows.map(([label, value], i) => (
          <div
            key={label}
            className={cn(
              "flex items-baseline justify-between gap-4 py-3",
              i < rows.length - 1 && "border-b border-[hsl(var(--rule))]",
            )}
          >
            <dt className="text-[13px] text-[hsl(var(--subtle))]">{label}</dt>
            <dd className="m-0 text-right font-mono text-[13px] tabular-nums text-[hsl(var(--foreground))]">{value}</dd>
          </div>
        ))}
      </dl>

      {sub ? (
        <div className="mt-[18px]">
          <Button variant="secondary" className="w-full" loading={pending} onClick={manage}>
            Manage in Stripe
          </Button>
        </div>
      ) : null}

      {pastDue ? (
        <BillingNote tone="warning">
          <span>
            <b>Payment past due.</b> Your last invoice failed. Update your card in the portal to keep Pro — your plan
            drops to Free if it isn't resolved by the period end.
          </span>
        </BillingNote>
      ) : null}
    </aside>
  );
}
