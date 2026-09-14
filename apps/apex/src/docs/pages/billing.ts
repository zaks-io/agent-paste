import { BILLING_PLANS_TABLE_COLUMNS, billingPlansTableRows } from "../../plan-tiers";
import type { DocsPage } from "../types";

export const BILLING_DOC: DocsPage = {
  slug: "billing",
  title: "Billing and Plans",
  shortTitle: "Billing",
  summary: "Your Plan sets write allowance, retention, and caps. Reads are always free.",
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
          text: "Shared caps: 100 files per Revision, 100 published Revisions per Artifact, 60 requests per minute per actor, 300 per minute per Workspace.",
        },
      ],
    },
    {
      id: "upgrade",
      title: "Upgrade",
      blocks: [
        {
          kind: "paragraph",
          text: "Open `/billing` in the dashboard and choose a Pro interval. Checkout runs on Stripe; Pro activates as soon as you return, and webhooks plus daily reconciliation keep it in sync after that.",
        },
      ],
    },
    {
      id: "manage",
      title: "Manage subscription and invoices",
      blocks: [
        {
          kind: "paragraph",
          text: "The billing page opens the Stripe Customer Portal for changes and cancellation, and lists invoices with hosted and PDF links.",
        },
        {
          kind: "paragraph",
          text: "Billing changes write allowance and limits only. Recipients opening an Artifact URL are never metered.",
        },
      ],
    },
    {
      id: "statuses",
      title: "Subscription statuses",
      blocks: [
        {
          kind: "paragraph",
          text: "Stripe `active`, `trialing`, and `past_due` map to Pro. Everything else, including no subscription, maps to Free.",
        },
      ],
    },
  ],
};
