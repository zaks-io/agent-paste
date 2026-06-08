import { PLANS } from "@agent-paste/plans";
import { APP_BASE_URL } from "../copy";
import { pricingComparisonRows } from "../plan-tiers";
import { PRICING } from "../pricing";

const BILLING_URL = `${APP_BASE_URL}/billing`;

// Mirrors the shared Button's composed utilities for variant="primary" size="lg".
// Button renders a <button>; this CTA must be an anchor, so we reuse the classes.
const CTA_CLASS =
  "inline-flex select-none items-center justify-center gap-2 rounded-[var(--radius-sm)] font-medium " +
  "transition-[background-color,color,border-color] duration-150 ease-[var(--ease-out)] " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[hsl(var(--accent))] " +
  "bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))] hover:bg-[hsl(var(--accent-dim))] " +
  "h-[40px] px-[18px] text-[14px]";

const TABLE_WRAP_CLASS = "mt-[14px] overflow-x-auto rounded-[var(--radius-sm)] border border-[hsl(var(--rule))]";
const TABLE_CLASS = "w-full min-w-[560px] border-collapse text-[13.5px] leading-[1.45]";
const TH_CLASS =
  "border-b border-[hsl(var(--rule))] bg-[hsl(var(--surface))] px-[12px] py-[11px] text-left align-top font-semibold text-[hsl(var(--foreground))]";
const TD_CLASS = "border-b border-[hsl(var(--rule))] px-[12px] py-[11px] text-left align-top text-[hsl(var(--muted))]";

export function PricingPage() {
  const freePrice = PLANS.free.price?.month;
  const proPrice = PLANS.pro.price?.month;
  const rows = pricingComparisonRows();

  return (
    <main>
      <div className="flex flex-col gap-[clamp(40px,6vh,64px)]">
        <section className="flex flex-col items-start gap-[18px] border-b border-[hsl(var(--rule))] pb-[clamp(32px,5vh,48px)]">
          <div className="flex w-full flex-col items-start gap-[18px]">
            <p className="m-0 inline-flex items-center gap-[9px] font-mono text-[11.5px] font-medium uppercase leading-none tracking-[0.16em] text-[hsl(var(--subtle))]">
              {PRICING.eyebrow}
            </p>
            <h1 className="m-0 max-w-[18ch] font-display text-[clamp(34px,5.2vw,54px)] font-extrabold leading-[1.04] tracking-[-0.03em] text-balance text-[hsl(var(--foreground))] [font-feature-settings:'ss01']">
              {PRICING.headline}
              <span className="text-[hsl(var(--accent))]">.</span>
            </h1>
            <p className="m-0 max-w-[60ch] text-[clamp(16px,1.4vw,18px)] leading-[1.6] text-[hsl(var(--muted))]">
              {PRICING.lead}
            </p>
          </div>
        </section>

        <section className="grid gap-[16px] sm:grid-cols-2" aria-label="Plan prices">
          <div className="grid gap-[12px] rounded-[var(--radius-sm)] border border-[hsl(var(--rule))] bg-[hsl(var(--surface))] p-[20px]">
            <h2 className="font-display text-[20px] font-bold tracking-[-0.015em] text-[hsl(var(--foreground))]">
              {PLANS.free.name}
            </h2>
            <p className="m-0 flex items-baseline gap-[4px] font-mono">
              <span className="text-[28px] text-[hsl(var(--foreground))]">{freePrice?.amount ?? "$0"}</span>
              <span className="text-[13px] text-[hsl(var(--subtle))]">{freePrice?.per ?? "/ mo"}</span>
            </p>
            <p className="text-[14px] leading-[1.5] text-[hsl(var(--muted))]">
              For trying agent-paste and everyday handoffs.
            </p>
          </div>
          <div className="grid gap-[12px] rounded-[var(--radius-sm)] border border-[hsl(var(--rule-strong))] bg-[hsl(var(--surface))] p-[20px]">
            <h2 className="font-display text-[20px] font-bold tracking-[-0.015em] text-[hsl(var(--foreground))]">
              {PLANS.pro.name}
            </h2>
            <p className="m-0 flex items-baseline gap-[4px] font-mono">
              <span className="text-[28px] text-[hsl(var(--foreground))]">{proPrice?.amount ?? ""}</span>
              <span className="text-[13px] text-[hsl(var(--subtle))]">{proPrice?.per ?? "/ mo"}</span>
            </p>
            <p className="text-[14px] leading-[1.5] text-[hsl(var(--muted))]">
              Higher allowance, longer retention, and Live Updates.
            </p>
            <a className={`${CTA_CLASS} mt-[4px] justify-self-start`} href={BILLING_URL}>
              Upgrade to Pro
            </a>
          </div>
        </section>

        <section className="grid gap-[16px]" aria-label="Free vs Pro comparison">
          <h2 className="m-0 font-display text-[clamp(20px,2.2vw,26px)] font-bold leading-[1.2] tracking-[-0.02em] text-[hsl(var(--foreground))]">
            Compare plans
          </h2>
          <div className={TABLE_WRAP_CLASS}>
            <table className={TABLE_CLASS}>
              <thead>
                <tr>
                  <th className={TH_CLASS}>Feature</th>
                  <th className={TH_CLASS}>{PLANS.free.name}</th>
                  <th className={TH_CLASS}>{PLANS.pro.name}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.feature} className="[&:last-child>td]:border-b-0">
                    <td className={TD_CLASS}>{row.feature}</td>
                    <td className={TD_CLASS}>{row.free}</td>
                    <td className={TD_CLASS}>{row.pro}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[14px] leading-[1.55] text-[hsl(var(--muted))]">
            Shared caps apply on every plan: 100 files per Revision, 100 lifetime published Revisions per Artifact, and
            rate limits for abuse protection. See{" "}
            <a className="underline decoration-[hsl(var(--accent)/0.4)] underline-offset-2" href="/docs/billing">
              Billing and Plans
            </a>{" "}
            for checkout and subscription details.
          </p>
        </section>
      </div>
    </main>
  );
}
