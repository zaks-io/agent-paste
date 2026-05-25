# Open-Core Billing: Plan-Tiered Usage Policy, Disabled by Default

Status: Accepted.

A **Plan** (`free` or `pro`) selects both which platform-defined **Usage Policy** values apply to a **Workspace** (always within the platform hard ceilings from [ADR 0056](./0056-mvp-usage-policy-defaults-and-platform-caps.md)) and which platform features the **Workspace** can use. The entire billing surface sits behind one deploy-time flag that is **off by default**: with billing off the `plan` column is ignored, every **Workspace** runs a single operator-configurable cap set that defaults to the `pro` values, and the Stripe Checkout / Customer Portal surfaces are never mounted. The open-source repository is therefore fully functional with no payment processor; the hosted deployment is the only place that flips the flag on and sells `pro`.

## Context

agent-paste is going open-core: the code is public under a permissive license, and the monetized asset is the hosted service, not the source. The code is not a moat (no secret algorithm, data moat, or network effect), so the billing logic can live in the open repo as long as a self-hoster never has to stand up Stripe to run the product. The hosted tier still beats self-hosting on its own merits because the Cloudflare / R2 / Neon / WorkOS stack is more hassle to operate than the subscription costs.

[ADR 0056](./0056-mvp-usage-policy-defaults-and-platform-caps.md) defined one platform cap set, and [ADR 0066](./0066-cli-first-mvp-contract-narrowing.md) narrowed the MVP to that single set with no tiering. This ADR layers a two-tier **Plan** on top of those caps without changing that they remain the hard ceiling.

## Decision

- **`workspaces.plan` is the single entitlement input.** A `plan` column (`free | pro`, default `free`, DB `CHECK`) follows the `workspaces.auto_deletion_days` precedent (migration 0007). Enforcement reads only this local column; it never calls Stripe. How the column gets written is [ADR 0074](./0074-stripe-billing-as-a-sync-layer-over-a-local-source-of-truth.md).
- **A Plan selects Usage Policy values; it never exceeds the platform ceiling.** `pro` raises a **Workspace**'s effective caps toward the platform maximum from ADR 0056; it cannot exceed it. The resolved values are still exposed read-only through the existing `GET /v1/usage-policy` surface so agents plan around them.
- **Plan tunes retention, size, and volume only.** The cap levers a **Plan** moves are TTL / Retention, file and **Revision** / **Bundle** size caps, and live-**Artifact** volume. Retention is the primary lever; storage cost is bounded by TTL and R2 egress is free, so a short Free TTL is both the value wall and the cost control. Rate limits are deliberately **not** a Plan lever: per [ADR 0064](./0064-native-ratelimit-bindings-for-authenticated-counters.md) and [ADR 0039](./0039-authenticated-rate-limits-under-usage-policy.md) they are an abuse ceiling, not a value meter, and selling headroom on them invites exactly the traffic they exist to bound.
- **A Plan gates features, not only caps.** Beyond cap values, a **Plan** determines which platform features a **Workspace** can use. **Live Update** ([ADR 0069](./0069-live-updates-via-stream-worker-and-per-artifact-durable-object.md)) is earmarked as the first `pro`-only feature: it is the "watch a folder, auto-reload" capability, and unlike storage it carries real marginal cost (persistent connections and per-**Artifact** Durable Objects), so gating it to the paying tier aligns the expensive capability with the revenue and the self-sustaining goal. Live Update is post-MVP; this records the model (**Plans** gate features) and the earmark, not a build commitment or timeline.
- **One deploy-time billing flag, off by default.** When off: the `plan` column is ignored; every **Workspace** resolves against one operator-configurable cap set whose defaults are the `pro` values; the Checkout / Portal / webhook routes are not registered; and the `BillingProvider` ([ADR 0074](./0074-stripe-billing-as-a-sync-layer-over-a-local-source-of-truth.md)) is the no-op adapter. When on (hosted only): `plan` drives caps, the Stripe surfaces mount, and `free` is the default for new **Workspaces**.
- **The billing surface is a severable package, not just a disabled flag.** All billing code (Checkout, Portal, webhook handling, the Stripe `BillingProvider` adapter) lives in a self-contained `packages/billing` mounted into `api` only when the flag is on. The open-core boundary is therefore physical: a self-hoster excludes the code path, not merely disables it at runtime. No separate `billing` Worker is introduced; endpoint placement and trust boundaries are [ADR 0074](./0074-stripe-billing-as-a-sync-layer-over-a-local-source-of-truth.md).

## Plan tiers

The intended `free` / `pro` values when billing is enabled, all within the [ADR 0056](./0056-mvp-usage-policy-defaults-and-platform-caps.md) platform ceilings. These are post-launch targets, tunable, and irrelevant when the billing flag is off (where every **Workspace** runs the `pro`-defaulted operator cap set).

| Lever                              | Free   | Pro     |
| ---------------------------------- | ------ | ------- |
| Default TTL                        | 3 days | 30 days |
| Max TTL ceiling                    | 7 days | 90 days |
| Live **Artifacts** / **Workspace** | 50     | 1,000   |
| File Size Cap                      | 10 MB  | 25 MB   |
| **Revision** Size Cap              | 25 MB  | 100 MB  |
| **Live Update**                    | off    | on      |

Retention is the sharp lever; the 3-day Free default fits the "here, show me this" / daily-report use case and is the wall a daily user hits repeatedly. The live-**Artifact** cap assumes self-serve cleanup (CLI delete + a dashboard list, both net-new) so a **Workspace** can free room before TTL, though a 3-day Free TTL self-clears the count regardless, so the cap rarely binds. File and **Revision** sizes are a mild `pro` carrot, not a real cost or value axis. **Live Update** is the one feature-gated lever.

## Considered Options

- **Closed source, hosted only.** Simplest licensing story, but forgoes the portfolio and distribution value of a public repo for no real protection gain, since the code was never the moat.
- **Open source with the paid code in a separate private repo.** Keeps payment code entirely out of the public tree, but splits one product across two repos and complicates the build. Rejected in favor of a severable in-repo `packages/billing` mounted only when the flag is on: the same clean boundary for self-hosters with one repo to build.
- **Billing on by default with a free-forever tier.** Matches most SaaS, but forces every self-hoster to confront Stripe config and an inapplicable `free`/`pro` split. Rejected in favor of off-by-default so the open-source default is "one generous cap set, no payments."

## Consequences

- Self-hosters get the full product with `pro`-equivalent caps and zero billing surface. There is no supported self-host paid tier; source is as-is.
- The hot path reads one local column and is identical whether billing is on or off (off just means the column is ignored and caps come from the operator-configured default set). No request path ever calls Stripe.
- The default-off cap set defaulting to `pro` (not `free`) is the surprising part: with billing off, "no Plan" means generous, not restricted. This is intentional. `free` is a hosted commercial construct, not a self-host limitation.
- Tiering is now a first-class domain concept (**Plan** in `CONTEXT.md`), so future tiers (e.g. a usage tier for embedders) extend an existing axis rather than introducing a new one.
