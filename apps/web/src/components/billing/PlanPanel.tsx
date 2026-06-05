import type { BillingInterval, BillingStatusResponse } from "@agent-paste/contracts";
import { Check } from "lucide-react";
import { useState } from "react";
import { cn } from "../../lib/cn";
import { startCheckoutFn } from "../../rpc/web-mutations";
import { Button } from "../ui/Button";
import { SectionLabel } from "../ui/Card";
import { errorToast, useToast } from "../ui/toast-context";
import { PRO_PRICE } from "./format";

const PLAN_FEATURES = {
  free: ["100 new artifacts per day", "Unlimited reads, no egress cost", "Ephemeral + claimable artifacts"],
  pro: ["2,000 new artifacts per day", "Priority artifact retention", "Customer Portal self-serve billing"],
} as const;

export function PlanPanel({ status }: { status: BillingStatusResponse }) {
  const { push } = useToast();
  const [interval, setInterval] = useState<BillingInterval>("month");
  const [pending, setPending] = useState(false);
  const isFree = status.plan === "free";
  const price = PRO_PRICE[interval];

  async function upgrade() {
    if (pending) return;
    setPending(true);
    try {
      const result = await startCheckoutFn({ data: { interval } });
      if (result.error) {
        push(errorToast("Couldn't start checkout", result.error));
        return;
      }
      window.location.assign(result.data.url);
    } finally {
      setPending(false);
    }
  }

  return (
    <section>
      <SectionLabel className="mb-[18px]">{isFree ? "Choose a plan" : "Your plan"}</SectionLabel>

      {isFree && !status.operator_override ? (
        <div className="mb-4 inline-flex overflow-hidden rounded-[var(--radius-sm)] border border-[hsl(var(--rule-strong))]">
          {(["month", "year"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={interval === value}
              onClick={() => setInterval(value)}
              className={cn(
                "border-0 bg-transparent px-3 py-1.5 font-mono text-[11.5px] uppercase tracking-[0.04em] text-[hsl(var(--muted))]",
                "cursor-pointer transition-colors [&+button]:border-l [&+button]:border-[hsl(var(--rule-strong))]",
                "aria-pressed:bg-[hsl(var(--accent-tint))] aria-pressed:text-[hsl(var(--foreground))]",
              )}
            >
              {value === "month" ? "Monthly" : "Annual"}
              {value === "year" ? <span className="ml-1.5 text-[hsl(var(--success))]">−2 mo</span> : null}
            </button>
          ))}
        </div>
      ) : null}

      <div className="grid gap-3.5">
        <PlanCard name="Free" price="$0" per="/ mo" current={isFree} features={PLAN_FEATURES.free} />
        <PlanCard
          name="Pro"
          price={price.amount}
          per={price.per}
          current={!isFree}
          featured={isFree}
          recommended={isFree}
          features={PLAN_FEATURES.pro}
        />
      </div>

      {isFree && !status.operator_override ? (
        <div className="mt-[18px] flex flex-wrap items-center gap-2.5">
          <Button size="lg" loading={pending} onClick={upgrade}>
            Upgrade to Pro
          </Button>
          <span className="font-mono text-[11px] text-[hsl(var(--faint))]">Opens Stripe Checkout · cancel anytime</span>
        </div>
      ) : null}
    </section>
  );
}

function PlanCard({
  name,
  price,
  per,
  current,
  featured,
  recommended,
  features,
}: {
  name: string;
  price: string;
  per: string;
  current: boolean;
  featured?: boolean;
  recommended?: boolean;
  features: ReadonlyArray<string>;
}) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius-md)] border px-[18px] py-4 transition-colors",
        current
          ? "border-[hsl(var(--rule-strong))] bg-[hsl(var(--surface-2))]"
          : featured
            ? "border-[hsl(var(--accent)/0.55)]"
            : "border-[hsl(var(--rule))]",
      )}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="flex items-center gap-2 font-display text-[15px] font-semibold">
          {name}
          {recommended ? (
            <span className="inline-flex items-center gap-1.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.1em] text-[hsl(var(--accent))]">
              <span className="h-[6px] w-[6px] rounded-full bg-[hsl(var(--accent))]" />
              Recommended
            </span>
          ) : null}
        </span>
        <span className="font-mono text-[13px] tabular-nums text-[hsl(var(--subtle))]">
          <b className="text-[17px] font-medium text-[hsl(var(--foreground))]">{price}</b> {per}
        </span>
      </div>
      <ul className="mt-3 grid list-none gap-[7px] p-0">
        {features.map((feature) => (
          <li key={feature} className="flex items-start gap-2.5 text-[12.5px] text-[hsl(var(--muted))]">
            <Check aria-hidden size={13} strokeWidth={2.25} className="mt-0.5 shrink-0 text-[hsl(var(--accent))]" />
            {feature}
          </li>
        ))}
      </ul>
    </div>
  );
}
