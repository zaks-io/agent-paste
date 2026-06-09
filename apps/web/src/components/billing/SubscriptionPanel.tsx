import type { BillingStatusResponse } from "@agent-paste/contracts";
import { Button, cn, SectionLabel } from "@agent-paste/ui";
import { useState } from "react";
import { openPortalFn } from "../../rpc/web-mutations";
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
      <SectionLabel className="mb-4">Subscription</SectionLabel>
      <dl className="grid">
        {rows.map(([label, value], i) => (
          <div
            key={label}
            className={cn(
              "flex items-baseline justify-between gap-4 py-3",
              i < rows.length - 1 && "border-b border-rule",
            )}
          >
            <dt className="text-sm text-subtle">{label}</dt>
            <dd className="m-0 text-right font-mono text-sm tabular-nums text-foreground">{value}</dd>
          </div>
        ))}
      </dl>

      {sub ? (
        <div className="mt-4">
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
