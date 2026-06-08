import { PLANS } from "@agent-paste/plans";
import { APP_BASE_URL } from "../copy";
import { pricingComparisonRows } from "../plan-tiers";
import { PRICING } from "../pricing";

const BILLING_URL = `${APP_BASE_URL}/billing`;

export function PricingPage() {
  const freePrice = PLANS.free.price?.month;
  const proPrice = PLANS.pro.price?.month;
  const rows = pricingComparisonRows();

  return (
    <main className="content">
      <section className="hero">
        <div className="hero-text">
          <p className="eyebrow mono">{PRICING.eyebrow}</p>
          <h1 className="hero-headline">
            {PRICING.headline}
            <span className="hero-stop">.</span>
          </h1>
          <p className="hero-lead">{PRICING.lead}</p>
        </div>
      </section>

      <section className="pricing-plans" aria-label="Plan prices">
        <div className="pricing-plan-card">
          <h2 className="pricing-plan-name">{PLANS.free.name}</h2>
          <p className="pricing-plan-price mono">
            <span className="pricing-plan-amount">{freePrice?.amount ?? "$0"}</span>
            <span className="pricing-plan-per">{freePrice?.per ?? "/ mo"}</span>
          </p>
          <p className="pricing-plan-note">For trying agent-paste and everyday handoffs.</p>
        </div>
        <div className="pricing-plan-card pricing-plan-card-pro">
          <h2 className="pricing-plan-name">{PLANS.pro.name}</h2>
          <p className="pricing-plan-price mono">
            <span className="pricing-plan-amount">{proPrice?.amount ?? ""}</span>
            <span className="pricing-plan-per">{proPrice?.per ?? "/ mo"}</span>
          </p>
          <p className="pricing-plan-note">Higher allowance, longer retention, and Live Updates.</p>
          <a className="button button-primary button-lg pricing-plan-cta" href={BILLING_URL}>
            Upgrade to Pro
          </a>
        </div>
      </section>

      <section className="pricing-compare" aria-label="Free vs Pro comparison">
        <h2 className="prose-title">Compare plans</h2>
        <div className="docs-table-wrap">
          <table className="docs-table">
            <thead>
              <tr>
                <th>Feature</th>
                <th>{PLANS.free.name}</th>
                <th>{PLANS.pro.name}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.feature}>
                  <td>{row.feature}</td>
                  <td>{row.free}</td>
                  <td>{row.pro}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="pricing-footnote">
          Shared caps apply on every plan: 100 files per Revision, 100 lifetime published Revisions per Artifact, and
          rate limits for abuse protection. See <a href="/docs/billing">Billing and Plans</a> for checkout and
          subscription details.
        </p>
      </section>
    </main>
  );
}
