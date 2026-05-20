# Native Cloudflare Rate-Limit Bindings for Authenticated Counters

Refines [ADR 0039](./0039-authenticated-rate-limits-under-usage-policy.md). Both the **Actor Rate Limit** and the **Workspace Burst Cap** are implemented as Cloudflare native rate-limit bindings (`[[ratelimits]]` in `wrangler.toml`), not Durable Object counters. The bindings live on `api` and `upload` only; `content` continues to enforce the unauthenticated **Artifact Rate Limit** per ADR 0039. ADR 0039 fixed the *model* (two-layer cap, post-auth, with idempotency replays free); this ADR fixes the *storage*.

## Considered Options

- **Durable Object per-Workspace counter, native binding for per-actor.** ADR 0039's default. The DO gives strong consistency across the whole **Workspace**, which is appealing in theory: the cap is exactly the cap, with no PoP-fan-out overshoot. Rejected because the per-request cost — a single-shard DO call on every authenticated `api` and `upload` request — dominates the auth hot path for the high-traffic case ADR 0062 already exists to defend against. Strong consistency is not what the limiter is *for*: the limiter exists to bound runaway behavior, not to be a billing meter.
- **Durable Object for both counters.** Worst of both worlds: every authenticated request pays for two DO round trips, and the per-actor DO partitions poorly across an unknown actor key space.
- **Native rate-limit binding for both counters (chosen).** Eventually consistent within the binding's period, no DO hop, no per-call billing beyond the binding-tier price. The trade-off is brief overshoot at PoP fan-out, which is fine because the cap is an abuse ceiling.
- **WAF rate-limiting rules in the Cloudflare dashboard.** Already rejected by ADR 0039 for the primary controls because the bucket cannot key on **API Key** or **Workspace** identity. Retained as a third defense-in-depth layer for unauthenticated traffic.

## Consequences

### Binding shape

`api/wrangler.toml` and `upload/wrangler.toml` each declare two bindings:

```toml
[[ratelimits]]
name = "ACTOR_RATE_LIMIT"
namespace_id = "<env-scoped>"
simple = { limit = <per ADR 0039 default>, period = 60 }

[[ratelimits]]
name = "WORKSPACE_BURST_CAP"
namespace_id = "<env-scoped>"
simple = { limit = <per ADR 0039 default>, period = 10 }
```

- `period` is restricted to `10` or `60` seconds by the platform. The 10-second window is appropriate for the **Workspace Burst Cap** (short spike protection); the 60-second window is appropriate for the **Actor Rate Limit** (sustained-rate enforcement).
- `namespace_id` is environment-scoped (`dev`, `staging`, `prod`) and committed in the per-environment wrangler config so a dev runaway cannot influence prod counters.
- A future limit that requires a different period composes by adding another binding, not by changing this one.

### Limit keys

- **Actor Rate Limit** key: `${workspaceId}:${actorId}` where `actorId` is the API Key `publicId` for bearer auth or the Auth0 `sub` for **Workspace Member** session auth. The `workspaceId` prefix guarantees a leaked or reused `publicId` cannot starve another tenant's identical-shaped key.
- **Workspace Burst Cap** key: `${workspaceId}`. Summed across every actor the **Workspace** owns.
- Keys are derived after the auth lookup that ADR 0062 caches, so the cache hit serves the limit key, not just the actor identity.

### Call site

- `api` and `upload` call `env.ACTOR_RATE_LIMIT.limit({ key })` and `env.WORKSPACE_BURST_CAP.limit({ key })` *after* authentication and scope checks, *before* business logic. The order is fixed by ADR 0039.
- A `{ success: false }` return triggers the `429` path with `Retry-After` and the `rate_limited_actor` / `rate_limited_workspace` error code per ADR 0039.
- The idempotency cache hit path from [ADR 0022](./0022-idempotency-keys-on-mutating-endpoints.md) resolves before either `limit()` call so replays do not consume budget. Already required by ADR 0039.
- A breach is operational telemetry per ADR 0039, written to the structured-log surface from [ADR 0011](./0011-cloudflare-first-observability.md). It is not an **Audit Event**.

### Trade-offs accepted

- **Eventual consistency across PoPs.** Cloudflare's native binding propagates the counter state across colos within the period, not synchronously. A **Workspace** that fans a burst across many PoPs can briefly exceed the cap by a small multiplier before the global view catches up. Accepted because the cap exists to stop runaway behavior, not to be a strict ceiling.
- **No programmatic decrement on downstream failure.** A request that consumes a `limit()` slot and then fails before the response still ticked the counter. Accepted for the same reason: the limiter is an abuse ceiling, not an exact request meter.
- **No runtime tuning.** Changing `limit` or `period` requires a deploy. Acceptable because ADR 0039 already states default ceilings will be tuned during rollout and a missing limit is a regression, not a deferred feature. Future per-tenant overrides below the platform cap (also flagged by ADR 0039) would be enforced by a second app-layer check, not by mutating the binding config.
- **Period granularity is fixed at 10 or 60 seconds.** Any future limit that needs a different window adds a new binding rather than reshaping the existing two.
- **`content` is unchanged.** It serves unauthenticated reads and continues to use the **Artifact Rate Limit** flow scoped to the **Artifact**, not to actor identity.

### Verification

- Integration tests cover four cases per binding: under-limit success, over-limit `429` with correct error code and `Retry-After`, idempotency-replay-skips-limit, and per-environment namespace isolation (a dev key cannot exhaust a prod counter).
- Operational logs carry the binding name on every fire so a runaway is attributable to the specific cap that triggered.

### What this ADR does not change

- The two-layer cap model, the post-auth enforcement order, the 429 envelope shape, the idempotency-skips-budget rule, and the operator-takedown response from ADR 0039.
- The `content` unauthenticated read path and **Artifact Rate Limit** semantics.
- The Cloudflare WAF defense-in-depth layer for unauthenticated brute-force scenarios.
