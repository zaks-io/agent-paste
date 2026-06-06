import { PLANS } from "@agent-paste/plans";
import type { FC } from "hono/jsx";
import { APP_BASE_URL } from "../copy.js";
import { pricingComparisonRows } from "../plan-tiers.js";
import { PRICING, PRICING_META } from "../pricing.js";
import { renderDocument, Shell } from "./chrome.js";

const BILLING_URL = `${APP_BASE_URL}/billing`;

const PricingPage: FC<{ nonce: string; analyticsToken?: string | undefined }> = ({ nonce, analyticsToken }) => {
  const freePrice = PLANS.free.price?.month;
  const proPrice = PLANS.pro.price?.month;
  const rows = pricingComparisonRows();

  return (
    <Shell meta={PRICING_META} nonce={nonce} analyticsToken={analyticsToken} billingEnabled={true}>
      <main class="content">
        <section class="hero">
          <div class="hero-text">
            <p class="eyebrow mono">{PRICING.eyebrow}</p>
            <h1 class="hero-headline">
              {PRICING.headline}
              <span class="hero-stop">.</span>
            </h1>
            <p class="hero-lead">{PRICING.lead}</p>
          </div>
        </section>

        <section class="pricing-plans" aria-label="Plan prices">
          <div class="pricing-plan-card">
            <h2 class="pricing-plan-name">{PLANS.free.name}</h2>
            <p class="pricing-plan-price mono">
              <span class="pricing-plan-amount">{freePrice?.amount ?? "$0"}</span>
              <span class="pricing-plan-per">{freePrice?.per ?? "/ mo"}</span>
            </p>
            <p class="pricing-plan-note">For trying agent-paste and everyday handoffs.</p>
          </div>
          <div class="pricing-plan-card pricing-plan-card-pro">
            <h2 class="pricing-plan-name">{PLANS.pro.name}</h2>
            <p class="pricing-plan-price mono">
              <span class="pricing-plan-amount">{proPrice?.amount ?? ""}</span>
              <span class="pricing-plan-per">{proPrice?.per ?? "/ mo"}</span>
            </p>
            <p class="pricing-plan-note">Higher allowance, longer retention, and Live Updates.</p>
            <a class="button button-primary button-lg pricing-plan-cta" href={BILLING_URL}>
              Upgrade to Pro
            </a>
          </div>
        </section>

        <section class="pricing-compare" aria-label="Free vs Pro comparison">
          <h2 class="prose-title">Compare plans</h2>
          <div class="docs-table-wrap">
            <table class="docs-table">
              <thead>
                <tr>
                  <th>Feature</th>
                  <th>{PLANS.free.name}</th>
                  <th>{PLANS.pro.name}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr>
                    <td>{row.feature}</td>
                    <td>{row.free}</td>
                    <td>{row.pro}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p class="pricing-footnote">
            Shared caps apply on every plan: 100 files per Revision, 100 lifetime published Revisions per Artifact, and
            rate limits for abuse protection. See <a href="/docs/billing">Billing and Plans</a> for checkout and
            subscription details.
          </p>
        </section>
      </main>
    </Shell>
  );
};

export function renderPricingPage(nonce: string, analyticsToken?: string): string {
  return renderDocument(<PricingPage nonce={nonce} analyticsToken={analyticsToken} />);
}
