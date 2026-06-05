# plans

Presentational Plan definitions, consumed by the `apps/web` billing dashboard (and intended for the `apps/apex` landing page once it renders pricing).

Responsibilities:

- `PLANS`: per-tier display name, orientation-only price, and feature copy.
- Sources the headline daily-allowance bullet from the enforced `@agent-paste/config` constants, so the number is never re-typed as prose.

This is the presentational half of a Plan. The enforced caps (the Usage Policy) live in `@agent-paste/config`; this package is never a charge authority (Stripe owns money).
