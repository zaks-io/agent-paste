# @agent-paste/billing

Stripe billing sync layer (ADR 0073/0074). Checkout, webhooks, and Customer Portal mount in `api` when billing is enabled; this package holds shared entitlement projection and the daily reconciliation backstop used by `apps/jobs`.
