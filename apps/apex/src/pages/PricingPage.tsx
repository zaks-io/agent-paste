import { PLANS } from "@agent-paste/plans";
import { ButtonAnchor } from "@agent-paste/ui";
import {
  Eyebrow,
  PageHeader,
  SectionHeading,
  TABLE_CLASS,
  TABLE_WRAP_CLASS,
  TD_CLASS,
  TH_CLASS,
} from "../components/marketing";
import { APP_BASE_URL } from "../copy";
import { pricingComparisonRows } from "../plan-tiers";
import { PRICING } from "../pricing";

const BILLING_URL = `${APP_BASE_URL}/billing`;

export function PricingPage() {
  const freePrice = PLANS.free.price?.month;
  const proPrice = PLANS.pro.price?.month;
  const rows = pricingComparisonRows();

  return (
    <main>
      <div className="flex flex-col gap-[clamp(40px,6vh,64px)]">
        <PageHeader
          eyebrow={<Eyebrow dot={false}>{PRICING.eyebrow}</Eyebrow>}
          title={
            <>
              {PRICING.headline}
              <span className="text-accent">.</span>
            </>
          }
          summary={PRICING.lead}
        />

        <section className="grid gap-4 sm:grid-cols-2" aria-label="Plan prices">
          <div className="grid gap-3 rounded-sm border border-rule bg-surface p-5">
            <h2 className="font-display text-h2 font-bold tracking-tighter text-foreground">{PLANS.free.name}</h2>
            <p className="m-0 flex items-baseline gap-1 font-mono">
              <span className="text-h1 text-foreground">{freePrice?.amount ?? "—"}</span>
              <span className="text-sm text-subtle">{freePrice?.per ?? "/ mo"}</span>
            </p>
            <p className="text-base leading-normal text-muted">For trying agent-paste and everyday handoffs.</p>
          </div>
          <div className="grid gap-3 rounded-sm border border-rule-strong bg-surface p-5">
            <h2 className="font-display text-h2 font-bold tracking-tighter text-foreground">{PLANS.pro.name}</h2>
            <p className="m-0 flex items-baseline gap-1 font-mono">
              <span className="text-h1 text-foreground">{proPrice?.amount ?? "—"}</span>
              <span className="text-sm text-subtle">{proPrice?.per ?? "/ mo"}</span>
            </p>
            <p className="text-base leading-normal text-muted">Higher allowance, longer retention, and Live Updates.</p>
            <ButtonAnchor className="mt-1 justify-self-start" href={BILLING_URL} size="lg">
              Upgrade to Pro
            </ButtonAnchor>
          </div>
        </section>

        <section className="grid gap-4" aria-label="Free vs Pro comparison">
          <SectionHeading>Compare plans</SectionHeading>
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
          <p className="text-base leading-relaxed text-muted">
            Shared caps apply on every plan: 100 files per Revision, 100 lifetime published Revisions per Artifact, and
            rate limits for abuse protection. See{" "}
            <a className="underline decoration-accent/40 underline-offset-2" href="/docs/billing">
              Billing and Plans
            </a>{" "}
            for checkout and subscription details.
          </p>
        </section>
      </div>
    </main>
  );
}
