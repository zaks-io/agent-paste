# Authenticated Rate Limits Under Usage Policy

Two new platform-controlled limits, **Actor Rate Limit** and **Workspace Burst Cap**, sit under **Usage Policy** alongside the existing creation, retention, and access-link controls. They bound the request rate of authenticated traffic at two layers: a per-actor cap (one **API Key** or one **Workspace Member**) and an aggregate cap (the whole **Workspace** summed across every actor it owns). Both are enforced in `api` and `upload` after authentication and scope checks. Both return `429` with `Retry-After`. The principle they encode is that a valid **API Key** — or a valid **Workspace Member** session — does not grant unbounded throughput: a runaway agent or a misbehaving script must hit a platform-controlled ceiling before it can damage the platform, even when every request is otherwise authorized.

## Considered Options

- **Single per-actor cap only.** Simpler, but the "many keys runaway in parallel" case bypasses it. A **Workspace** can mint several **API Keys**; only an aggregate cap bounds the tenant.
- **Single per-Workspace cap only.** Protects the platform, but one runaway key inside a workspace starves the workspace's other keys. The noisy key is anonymous within the cap, so detection and response are harder.
- **Two-layer cap (chosen).** Per-actor isolates one runaway key or member from its peers; per-**Workspace** defends the platform from tenant-wide failures. The two layers compose naturally.
- **Rely on Cloudflare WAF rate limiting only.** Free baseline, but the bucket cannot key on **API Key** or **Workspace** identity, cannot compose with idempotency replays (ADR 0022), and cannot feed the audit and error-envelope contracts (ADR 0036). Kept as a third defense-in-depth layer outside the model, not as the primary control.

## Consequences

- **Usage Policy** extends to cover **Actor Rate Limit** and **Workspace Burst Cap**. CONTEXT.md adds both terms and the corresponding relationships.
- Both limits are platform-controlled in the MVP; **Workspace** settings cannot raise them. A future **Workspace** tier could lower them per-tenant but never above the platform cap, matching the **Auto Deletion** platform-cap pattern.
- Enforcement applies only on `api` and `upload`. `content` uses **Artifact Rate Limit** (ADR uses CONTEXT.md term) for the unauthenticated read path; signed-URL reads on `content` carry no actor identity to key on, so the artifact-level cap remains the right control there.
- Limits run _after_ authentication and scope checks. Unauthenticated callers receive `401`/`404` before counting against any bucket, so failed-auth floods cannot poison legitimate actors' budgets. Brute-force credential probing is handled by Cloudflare WAF, not by this model.
- `429` responses use the error envelope from ADR 0036 with distinct snake_case codes for the two layers (for example, `rate_limited_actor` and `rate_limited_workspace`) so clients can back off appropriately and operators can see which ceiling fired.
- Idempotency replays (ADR 0022) resolve from the idempotency cache before reaching the rate limiter and do **not** consume **Actor Rate Limit** or **Workspace Burst Cap** budget; well-behaved retries on transient errors will not trigger 429.
- A breach of either limit is operational telemetry, not an **Audit Event**. Sustained breaches are an abuse signal and feed into the future platform-initiated-takedown surface; that response surface is out of scope for this ADR.
- Storage for both counters is Cloudflare native rate-limit bindings (`[[ratelimits]]`) per [ADR 0064](./0064-native-ratelimit-bindings-for-authenticated-counters.md). The model is fixed by this ADR; the storage choice is a separable refinement.
- Default ceilings are not part of this ADR. They will be tuned during MVP rollout, but every authenticated route must enforce some cap from day one — a missing limit is a regression, not a deferred feature.
