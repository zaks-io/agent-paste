import { BILLING_PLANS_TABLE_COLUMNS, billingPlansTableRows } from "../../plan-tiers.js";
import type { DocsPage } from "../types.js";

export const BILLING_DOC: DocsPage = {
  slug: "billing",
  title: "Billing and Plans",
  shortTitle: "Billing",
  summary: "Hosted billing is enabled: your Plan sets write allowance, retention, caps, and Live Updates.",
  sections: [
    {
      id: "plans",
      title: "Plans",
      blocks: [
        {
          kind: "table",
          columns: [...BILLING_PLANS_TABLE_COLUMNS],
          rows: billingPlansTableRows(),
        },
        {
          kind: "paragraph",
          text: "Shared caps: 100 files per Revision, 100 lifetime published Revisions per Artifact, 60 actor requests per minute, and 300 Workspace burst requests per minute.",
        },
      ],
    },
    {
      id: "upgrade",
      title: "Upgrade",
      blocks: [
        {
          kind: "paragraph",
          text: "Open `/billing` in the dashboard and choose the Pro interval. The dashboard creates a Stripe Checkout session and redirects you to Stripe.",
        },
        {
          kind: "paragraph",
          text: "After a successful Checkout return, the dashboard activates Pro synchronously, refreshes the billing cache, and shows the updated Plan. Stripe webhooks and daily reconciliation keep local entitlement state converged after that.",
        },
      ],
    },
    {
      id: "manage",
      title: "Manage subscription and invoices",
      blocks: [
        {
          kind: "paragraph",
          text: "The billing page can open Stripe Customer Portal for subscription management and cancellation. It also lists Stripe invoices with hosted invoice and PDF links when Stripe provides them.",
        },
        {
          kind: "paragraph",
          text: "Reads are always free. Billing changes write allowance and feature limits; it does not meter recipients opening an Artifact or Access Link.",
        },
      ],
    },
    {
      id: "statuses",
      title: "Subscription statuses",
      blocks: [
        {
          kind: "paragraph",
          text: "Stripe `active`, `trialing`, and `past_due` subscriptions map to Pro. Canceled, unpaid, incomplete, expired, paused, or missing subscriptions map to Free.",
        },
      ],
    },
  ],
};
