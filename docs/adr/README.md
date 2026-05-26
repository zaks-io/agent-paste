# Architecture Decision Records

This directory is the implementation-facing decision log for agent-paste. ADRs are historical records, but the set must still be navigable enough that an implementer can find the current decision without reconstructing the whole conversation.

## Maintenance Rules

- ADR numbers are never reused. If a decision is inserted late, use the next available number.
- Superseded ADRs stay in the tree. Add a `Status:` line below the title with links to the superseding ADRs, and keep only enough historical text to explain why the old path was retired.
- If a new ADR supersedes one paragraph or bullet in an older ADR, update the older ADR with a local note or revised wording. Do not rely on readers noticing a later contradiction.
- Cross-references should use markdown links when the reference carries implementation weight.
- `CONTEXT.md` owns domain language. ADRs may refine implementation, but they should not introduce a competing term for an existing domain concept.

## Current Conflict Resolutions

- [ADR 0028](./0028-signed-url-tokens-for-content-gateway-authorization.md) is the canonical content-origin authorization model. `content` verifies short-lived content-gateway tokens, reads R2, checks KV denylist state, and has no Hyperdrive binding.
- [ADR 0031](./0031-signed-content-urls-with-kid-rotation.md) is superseded. Its private-read URL design was folded into ADR 0028.
- [ADR 0047](./0047-access-link-signed-url-with-fragment-encoded-payload.md) is the canonical Access Link model. Access Links are fragment-encoded signed URLs, not stored bearer tokens.
- [ADR 0052](./0052-agent-view-discovery-from-access-link-signed-urls.md) is the canonical Agent View discovery model for unauthenticated recipients. It replaces code-scoped `GET /v1/r/{code}/agent-view` and `GET /v1/s/{code}/agent-view` routes.
- [ADR 0046](./0046-operator-identity-and-web-admin-surface.md) refines [ADR 0040](./0040-platform-lockdown-for-operator-initiated-takedown.md): operator actions use `/admin/...` routes on `api`, production Cloudflare Access, `requireOperator()`, and no API Key path.
- [ADR 0060](./0060-cli-authentication-via-auth0-loopback.md) is the canonical interactive CLI auth model: `agent-paste login` via WorkOS loopback PKCE (decided; replaces the original Auth0 framing, consistent with ADR 0068). `agent-paste login` is primary for humans; `AGENT_PASTE_API_KEY` remains for CI/headless use.
- [ADR 0061](./0061-mcp-worker-with-oauth-only-via-auth0-dcr.md) is the canonical MCP model. MCP is OAuth-only through WorkOS AuthKit/Connect, uses Client ID Metadata Document (CIMD) as the primary client self-identification path, keeps DCR enabled for compatibility, and uses explicit `write`, `read`, and `share` scopes without dashboard implicit grants.
- [ADR 0066](./0066-cli-first-mvp-contract-narrowing.md) narrows the executable contract to the CLI-first MVP. It supersedes broader platform-era contract assumptions for MVP implementation, including larger usage-policy caps and app-layer encryption as an immediate build gate.
- [ADR 0067](./0067-interim-production-security-baseline-before-app-service.md) records the interim production security baseline while the app service, dashboard, and MCP surface are still deferred.
- [ADR 0068](./0068-workos-authkit-for-web-app-auth.md) supersedes [ADR 0002](./0002-auth0-for-workspace-authentication.md) for `apps/web`. The dashboard authenticates through WorkOS AuthKit via the official `@workos/authkit-tanstack-react-start` integration. The CLI provider is WorkOS loopback PKCE ([ADR 0060](./0060-cli-authentication-via-auth0-loopback.md)); the MCP provider is WorkOS AuthKit/Connect ([ADR 0061](./0061-mcp-worker-with-oauth-only-via-auth0-dcr.md)). WorkOS is the single human-auth provider for web, CLI login, and MCP.
- [ADR 0070](./0070-repository-core-ports-and-adapters.md) is the canonical repository structure. One backend-agnostic `RepositoryCore` holds all domain orchestration; the Postgres and local backends supply only `Entities` and `UnitOfWork` adapters; both `apps/api` and `apps/upload` depend on the single `Repository` interface exported from [`@agent-paste/db`](../../packages/db) rather than per-app structural copies.
- [ADR 0071](./0071-signed-token-codec-and-tokens-package.md) is the canonical signed-token implementation. One `@agent-paste/tokens` codec owns the `base64url(payload).hmac` wire scheme and a non-throwing `verify`; the Content-Gateway Token, Agent-View Token, and upload signed-URL token are per-kind modules over it; `packages/auth` and the three Workers no longer carry their own HMAC/base64/constant-time copies. Refines [ADR 0028](./0028-signed-url-tokens-for-content-gateway-authorization.md) without changing the authorization model.
- [ADR 0072](./0072-contract-driven-route-registrar-and-guard.md) makes the [`packages/contracts`](../../packages/contracts) route registry the runtime enforcement source. `@agent-paste/worker-runtime` mounts each Route Contract through one registrar and a uniform Request Guard (auth resolve, scopes, rate-limit class, idempotency-header shaping, error envelope); the only injected seam is the per-Worker `AuthResolvers`. Preserves [ADR 0035](./0035-runcommand-sequencing-and-idempotency-records.md), [ADR 0036](./0036-error-envelope-and-generic-404-boundary.md), and [ADR 0039](./0039-authenticated-rate-limits-under-usage-policy.md).
- [ADR 0073](./0073-open-core-billing-plan-tiered-usage-policy-disabled-by-default.md) is the canonical billing-entitlement model. A `free` / `pro` **Plan** selects **Usage Policy** values within the [ADR 0056](./0056-mvp-usage-policy-defaults-and-platform-caps.md) hard ceilings and gates platform features (Live Update is the earmarked first `pro`-only feature); the whole billing surface is behind one deploy-time flag that is off by default, where the `plan` column is ignored and every **Workspace** runs a `pro`-defaulted operator-configurable cap set, with billing code isolated in a severable `packages/billing`. Layers tiering onto [ADR 0066](./0066-cli-first-mvp-contract-narrowing.md)'s single MVP cap set without superseding it.
- [ADR 0074](./0074-stripe-billing-as-a-sync-layer-over-a-local-source-of-truth.md) is the canonical Stripe integration model. The local DB (`workspaces.plan`) is the entitlement source of truth; the hot path never calls Stripe; `plan` converges through three idempotent writers (synchronous Checkout activation, out-of-order-tolerant webhooks, and a `jobs` reconciliation cron per [ADR 0032](./0032-jobs-worker-trigger-model-and-queue-topology.md)) so the system is correct with webhooks delayed, dropped, or disabled. All Stripe calls go through a `BillingProvider` seam in the [ADR 0070](./0070-repository-core-ports-and-adapters.md) style.
- [`packages/contracts`](../../packages/contracts) and [`docs/specs/contracts.md`](../specs/contracts.md) are the canonical MVP implementation contract for Zod schemas, ID formats, and the route registry. ADRs provide rationale; contracts provide field-level implementation shape.

## Best-Practice Baseline

These practices are part of the current architecture, not optional implementation preferences.

### Cloudflare Worker Boundaries

- Each deployable app owns its own Wrangler configuration, bindings, environment settings, and deploy script per [ADR 0009](./0009-typescript-and-per-app-cloudflare-config.md). The config file format is `wrangler.jsonc` per [ADR 0065](./0065-wrangler-jsonc-config-format.md); TOML is not used for new apps.
- Worker compatibility settings are explicit and reviewed. Use a current `compatibility_date`; enable `nodejs_compat` only for Workers or packages that need Node.js APIs. Cloudflare documents `nodejs_compat` as requiring a compatibility date of `2024-09-23` or later: <https://developers.cloudflare.com/workers/runtime-apis/nodejs/>.
- Bindings are least-privilege. `api` owns authenticated control-plane state, `upload` owns write paths into R2, `content` owns read-only untrusted-content serving, and `jobs` owns background maintenance per [ADR 0006](./0006-small-workers-by-trust-and-scaling-boundary.md), [ADR 0027](./0027-upload-write-path.md), and [ADR 0028](./0028-signed-url-tokens-for-content-gateway-authorization.md).
- `content` never gets a Hyperdrive binding and never talks to Postgres. It verifies signed content-gateway tokens, checks KV denylist state, and reads R2 only.
- Generate and commit Worker binding types when Wrangler config changes so TypeScript reflects the runtime contract.

### Performance and Cost on the Auth Hot Path

- Authenticated lookups on `api`, `upload`, and `content` go through the two-layer cache from [ADR 0062](./0062-two-layer-cache-for-hot-path-auth-lookups.md): L1 module-scope `Map` per isolate, L2 `caches.default` per colo, source on miss. The shared helper lives in `packages/auth` and is the only sanctioned cache shape.
- Counter increments (Actor Rate Limit, Workspace Burst Cap, idempotency record creation) never sit behind the cache. Positive denylist hits never sit behind the cache. The cache stores rows and terminal results, not decisions that require an atomic write.
- Rate-limit counters use Cloudflare native `[[ratelimits]]` bindings on `api` and `upload` per [ADR 0064](./0064-native-ratelimit-bindings-for-authenticated-counters.md), keyed by `${workspaceId}:${actorId}` for the per-actor cap and `${workspaceId}` for the per-Workspace burst cap. Eventual consistency across PoPs is accepted because the cap is an abuse ceiling, not a billing meter.

### Database and Tenant Isolation

- Postgres is the transactional source of truth for workspace metadata, reached from Workers through Hyperdrive per [ADR 0005](./0005-cloudflare-workers-r2-postgres-hyperdrive.md). Cloudflare positions Hyperdrive as the Worker path for reducing database connection setup latency: <https://developers.cloudflare.com/hyperdrive/configuration/how-hyperdrive-works/>.
- Every tenant table uses Postgres RLS, the application role is `NOBYPASSRLS`, and `SET LOCAL app.workspace_id = $1` is transaction-scoped before tenant queries per [ADR 0044](./0044-workspace-isolation-via-postgres-rls.md).
- Durable business writes go through `runCommand` so audit events and idempotency state commit with the state change per [ADR 0004](./0004-audit-state-changes-through-wrapper.md) and [ADR 0035](./0035-runcommand-sequencing-and-idempotency-records.md).
- Cross-workspace reads fail closed as not-found semantics, not authorization detail leaks, per [ADR 0036](./0036-error-envelope-and-generic-404-boundary.md).

### Credentials, Links, and Logging

- Access Links are not stored bearer tokens. The shareable credential is an **Access Link Signed URL** with the signed payload in the fragment per [ADR 0047](./0047-access-link-signed-url-with-fragment-encoded-payload.md).
- Server logs, traces, analytics, audit summaries, and error events never store API Key secrets, Access Link fragment payloads, content-gateway tokens, or full signed URLs.
- `/al/{publicId}` stays minimal: no analytics, no third-party scripts, no external assets, strict route-specific CSP, `Referrer-Policy: no-referrer`, and CORS limited to the matching app/API origins.
- The unauthenticated recipient path is `POST /v1/access-links/resolve` with `{ public_id, blob }`, followed by short-lived content-gateway URLs. Code-bearing Agent View routes are intentionally not part of the API per [ADR 0052](./0052-agent-view-discovery-from-access-link-signed-urls.md).
- API Key secrets use the `ap_pk_{env}_{publicId}_{secret}` shape, HMAC storage with a Worker-secret pepper, environment segregation, and parser rejection of retired `ap_al_*` values per [ADR 0043](./0043-bearer-credential-format-and-storage.md).

### Untrusted Content

- Uploaded files, paths, display metadata, manifest-derived values, and audit-visible agent data are all untrusted until escaped for the specific output context per [ADR 0024](./0024-treat-agent-provided-data-as-untrusted.md).
- Untrusted content is served only from the isolated content origin. Direct R2 read URLs are never returned per [ADR 0001](./0001-private-artifact-storage-behind-controlled-origin.md).
- Content responses use defense-in-depth headers: CSP, `Referrer-Policy`, `Permissions-Policy`, `X-Content-Type-Options: nosniff`, and iframe sandboxing per [ADR 0030](./0030-mvp-execution-policy-cdn-allowlisted-csp.md). Cloudflare's security-header example covers the same header family: <https://developers.cloudflare.com/workers/examples/security-headers/>.
- Served content type is derived from a fixed extension allowlist, not the agent-provided upload MIME type. Unknown extensions download as `application/octet-stream`; SVG gets a tighter per-response CSP per [ADR 0042](./0042-strict-extension-based-served-content-type.md).
- Application-layer encryption for artifact bytes is deferred out of the CLI-first MVP per [ADR 0066](./0066-cli-first-mvp-contract-narrowing.md). The MVP safety baseline is private R2, isolated content serving, signed content tokens, and no direct R2 URLs. [ADR 0063](./0063-application-layer-encryption-for-artifact-bytes.md) remains the future direction when that work is promoted.

### Operator and Admin Access

- Operator actions are outside the public agent API. They use `/admin/...` on `api`, production Cloudflare Access, WorkOS session resolution (ADR 0068), `OPERATOR_EMAILS`, and `requireOperator()` per [ADR 0046](./0046-operator-identity-and-web-admin-surface.md).
- API Keys can never assume operator authority. Admin routes reject API Key authentication before any scope checks.
- Automated rotation authenticates with a Cloudflare Access service token only (no Auth0/WorkOS M2M), mapped to the reserved `rotation-agent@platform` operator identity, with no bypass endpoint. Cloudflare Access service tokens are the documented machine-to-machine path for Access-protected applications: <https://developers.cloudflare.com/cloudflare-one/identity/service-tokens/>.
- Every operator mutation writes an Audit Event visible to affected Workspace Members.

### Background Work and Reliability

- Queue handlers are idempotent by target identity, not queue message identity, per [ADR 0049](./0049-jobs-handler-patterns.md).
- A DLQ gets a consumer only when terminal failure must update product state; otherwise it alerts for operator triage per [ADR 0050](./0050-bundle-availability-and-asymmetric-dlq-consumption.md).
- Post-commit work that invalidates access writes the denylist before enqueueing byte purge, with cron rediscovery as recovery. The accepted consistency window is bounded by the content-token TTL from [ADR 0028](./0028-signed-url-tokens-for-content-gateway-authorization.md).
- The safety scanner starts as a replaceable stub with stable warning storage and scanner versioning; real scanner integration plugs into the scanner interface without schema churn per [ADR 0051](./0051-safety-scanner-lifecycle.md).

### Observability and Audit

- Operational logs are structured JSON with request IDs propagated across apps, database writes, queues, and errors per [ADR 0011](./0011-cloudflare-first-observability.md).
- Audit Events are product/security records, not a substitute for operational logs.
- Public errors use the fixed envelope from [ADR 0036](./0036-error-envelope-and-generic-404-boundary.md). Clients branch on `error.code`, not message text or inferred status.
- Rate-limit responses use stable snake_case error codes and `Retry-After`; idempotency replays do not consume authenticated rate budgets per [ADR 0039](./0039-authenticated-rate-limits-under-usage-policy.md).

## Renumbered ADRs

These files were renumbered to remove duplicate IDs:

| Current                                                                  | Previous duplicate | Decision                                           |
| ------------------------------------------------------------------------ | -----------------: | -------------------------------------------------- |
| [ADR 0048](./0048-transient-artifacts-by-default.md)                     |               0032 | Transient Artifacts by Default                     |
| [ADR 0049](./0049-jobs-handler-patterns.md)                              |               0033 | Jobs Handler Patterns                              |
| [ADR 0050](./0050-bundle-availability-and-asymmetric-dlq-consumption.md) |               0034 | Bundle Availability and Asymmetric DLQ Consumption |
| [ADR 0051](./0051-safety-scanner-lifecycle.md)                           |               0035 | Safety Scanner Lifecycle                           |
| [ADR 0052](./0052-agent-view-discovery-from-access-link-signed-urls.md)  |               0043 | Agent View Discovery from Access Link Signed URLs  |
