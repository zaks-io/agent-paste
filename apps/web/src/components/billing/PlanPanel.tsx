import type { BillingInterval, BillingStatusResponse } from "@agent-paste/contracts";
import { PLANS } from "@agent-paste/plans";
import { Button, cn, SectionLabel } from "@agent-paste/ui";
import { Check } from "lucide-react";
import { useState } from "react";
import { startCheckoutFn } from "../../rpc/web-mutations";
import { errorToast, useToast } from "../ui/toast-context";

export function PlanPanel({ status }: { status: BillingStatusResponse }) {
  const { push } = useToast();
  const [interval, setInterval] = useState<BillingInterval>("month");
  const [pending, setPending] = useState(false);
  const isFree = status.plan === "free";
  const freePrice = PLANS.free.price?.[interval];
  const proPrice = PLANS.pro.price?.[interval];

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
      <SectionLabel className="mb-4">{isFree ? "Choose a plan" : "Your plan"}</SectionLabel>

      {isFree && !status.operator_override ? (
        <div className="mb-4 inline-flex overflow-hidden rounded-sm border border-rule-strong">
          {(["month", "year"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={interval === value}
              onClick={() => setInterval(value)}
              className={cn(
                "border-0 bg-transparent px-3 py-2 font-mono text-mono-sm uppercase tracking-wide text-muted",
                "cursor-pointer transition-colors [&+button]:border-l [&+button]:border-rule-strong",
                "aria-pressed:bg-accent-tint aria-pressed:text-foreground",
              )}
            >
              {value === "month" ? "Monthly" : "Annual"}
              {value === "year" ? <span className="ml-2 text-success">−2 mo</span> : null}
            </button>
          ))}
        </div>
      ) : null}

      <div className="grid gap-4">
        <PlanCard
          name={PLANS.free.name}
          price={freePrice?.amount ?? "$0"}
          per={freePrice?.per ?? "/ mo"}
          current={isFree}
          features={PLANS.free.features}
        />
        <PlanCard
          name={PLANS.pro.name}
          price={proPrice?.amount ?? ""}
          per={proPrice?.per ?? ""}
          current={!isFree}
          featured={isFree}
          recommended={isFree}
          features={PLANS.pro.features}
        />
      </div>

      {isFree && !status.operator_override ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button size="lg" loading={pending} onClick={upgrade}>
            Upgrade to Pro
          </Button>
          <span className="font-mono text-mono-sm text-faint">Opens Stripe Checkout · cancel anytime</span>
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
        "rounded-md border px-4 py-4 transition-colors",
        current ? "border-rule-strong bg-surface-2" : featured ? "border-accent/55" : "border-rule",
      )}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="flex items-center gap-2 font-display text-h3 font-semibold">
          {name}
          {recommended ? (
            <span className="inline-flex items-center gap-2 font-mono text-meta font-medium uppercase tracking-wider text-accent">
              <span className="h-[6px] w-[6px] rounded-full bg-accent" />
              Recommended
            </span>
          ) : null}
        </span>
        <span className="font-mono text-sm tabular-nums text-subtle">
          <b className="text-lg font-medium text-foreground">{price}</b> {per}
        </span>
      </div>
      <ul className="mt-3 grid list-none gap-2 p-0">
        {features.map((feature) => (
          <li key={feature} className="flex items-start gap-2 text-mono text-muted">
            <Check aria-hidden size={13} strokeWidth={2.25} className="mt-1 shrink-0 text-accent" />
            {feature}
          </li>
        ))}
      </ul>
    </div>
  );
}
