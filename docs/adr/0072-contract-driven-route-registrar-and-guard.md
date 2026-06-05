# Contract-Driven Route Registrar and Request Guard (`packages/worker-runtime`)

Status: Accepted. Amended 2026-06-05 by AP-236: rate-limit binding
unavailability now fails closed.

`api`, `upload`, and `content` stop inlining their auth / scope / rate-limit / idempotency /
error-envelope chains per route. A new `@agent-paste/worker-runtime` mounts each **Route
Contract** onto its Worker through one **Route Registrar** that runs a uniform **Request Guard**,
making the route registry in [`packages/contracts`](../../packages/contracts) the single runtime
enforcement source rather than documentation read only by OpenAPI generation.
`packages/contracts` stays pure types.

## Context

- The route registry (`packages/contracts/src/routes.ts`) declares `auth`, `scopes`, and
  `idempotency` for 26 routes but is consumed only by OpenAPI generation, which also hardcodes the
  paths. Nothing at runtime reads it. A route can drift from its contract and only the OpenAPI
  golden catches it, and only for the fields OpenAPI renders.
- Each Worker hand-writes the same guard sequence per route. `apps/api` inlines a byte-identical
  api-key chain at three call sites
  (`authenticateApiKey → 401 → rateLimitAuthenticatedRequest → 429 → apiDatabase → 503 → handler`)
  and wraps web routes in `withWebMember(context, scopes, run)`. `apps/upload` and `apps/content`
  carry their own variants. The auth-to-principal step, the scope check, the rate-limit class, the
  idempotency-header shaping, and the error envelope are repeated and can diverge.
- Error status mapping is implicit and scattered: each call site picks the HTTP status for an
  error code by hand.

## Decision

- New package `@agent-paste/worker-runtime`. Its interface is
  `createRegistrar(deps).mount(contract, handler)`:
  - `deps` carries the one real injected seam, `AuthResolvers`: a map from `AuthRequirement` to a
    resolver returning a principal or a typed failure. The set is disjoint per Worker and checked
    at boot against the contracts the Worker mounts.
  - `handler` is `(ctx, principal, db) => Promise<Response>`. `principal` is a discriminated union
    keyed by auth kind, so the handler reads `principal.kind` and gets the right actor type. The
    `db` argument is dropped by a conditional type when the Worker has no repository, so `content`
    handlers are `(ctx, principal)`.
- The **Request Guard** is one internal chain, not exposed as composable primitives. For each
  request it resolves the principal via `AuthResolvers`, applies the rate-limit class, checks
  scopes, shapes the `Idempotency-Key` header outcome, and renders any failure into the
  [ADR 0036](./0036-error-envelope-and-generic-404-boundary.md) error envelope. The order is fixed
  for every route.
- Rate limiting becomes a `rateLimit` field on the **Route Contract**:
  `"none" | "actor" | "artifact"`. `"actor"` is the actor-plus-workspace-burst pair
  ([ADR 0039](./0039-authenticated-rate-limits-under-usage-policy.md),
  [ADR 0064](./0064-native-ratelimit-bindings-for-authenticated-counters.md)); `"artifact"` is
  `content`'s per-artifact throttle. `applyRateLimit` is a pure function over the contract field
  and the injected Cloudflare rate-limit bindings. AP-236 changed binding unavailability from
  fail-open to fail-closed: missing or throwing actor/workspace/artifact bindings deny the guarded
  request using the existing public rate-limit error codes; missing or throwing ephemeral provision
  bindings deny provision with `ephemeral_provision_unavailable`.
- Error status is a single `ERROR_STATUS: Record<ErrorCode, number>` table.
  `errorResponse(code, requestId, env)` derives the status from the code; call sites stop passing
  a status.
- Idempotency in the guard is header shaping only: a malformed key is
  `400 invalid_idempotency_key`, an in-flight collision surfaced by `runCommand` is
  `409 idempotency_in_flight`. The durable claim stays inside `runCommand`'s DB transaction
  ([ADR 0035](./0035-runcommand-sequencing-and-idempotency-records.md) unchanged).
- `content` participates: the guard resolves `signed_content_token` and applies the `"artifact"`
  rate-limit class; the denylist read and R2 serve stay in the `content` handler. `withWebMember`
  collapses into a `workos_access_token` resolver that yields a Workspace Member actor.

### Seam analysis (deletion test)

- `AuthResolvers` is the one real seam: two-plus adapters exist (one set per Worker), and
  substituting fakes is how the guard is tested. It stays a port.
- The rate-limit store is a real Cloudflare binding injected as a value, not a port;
  `applyRateLimit` is pure except for warning logs on binding errors and fails closed when a
  binding is unavailable. The clock and idempotency are not ports: header shaping is pure and the
  durable claim lives in `runCommand`. The repository is an opaque generic `Deps` pass-through, not
  a port the runtime understands; `content` omits it. Deleting any of these would not concentrate
  complexity, so none earns a port.

### Reconciliations (verified at implementation, not assumed)

1. The scope check and rate-limit ordering is uniform across routes. Rate-limit runs before the
   scope check so a flood of forbidden requests is still throttled; for api-key routes the scope
   check is already satisfied at auth, so this is a no-op there.
2. The `ERROR_STATUS` table is reconciled against the current `upload` and `content` call-site
   statuses before wiring, so centralizing the mapping does not silently change a response status
   (the cap and expiry codes in particular).

## Consequences

- The route contract becomes load-bearing: mounting a route requires a contract, and the guard
  enforces its declared auth / scope / rate-limit / idempotency. A new route without a contract
  does not compile.
- The guard is the test surface. Auth, scope, rate-limit, and envelope behavior are tested once
  against fake `AuthResolvers` and fake bindings, not re-tested through each Worker's HTTP
  handlers.
- `apps/api` deletes its three inlined api-key chains and `withWebMember`; `apps/upload` and
  `apps/content` delete their guard variants. Handlers shrink to business logic over a resolved
  principal.
- Adding an auth kind is one entry in `AuthResolvers` plus widening the `AuthRequirement` union in
  `packages/contracts`. No registry abstraction is introduced for this; two consumers is not yet a
  seam for pluggable auth kinds.

## What this ADR does not change

- `packages/contracts` stays pure types and Zod
  ([ADR 0038](./0038-zod-schemas-as-source-of-truth-for-contracts.md)); the registrar consumes the contract, the
  contract does not import the runtime.
- [ADR 0035](./0035-runcommand-sequencing-and-idempotency-records.md) runCommand sequencing and
  the durable idempotency claim are untouched; the guard only shapes the header outcome.
- [ADR 0036](./0036-error-envelope-and-generic-404-boundary.md) error envelope,
  [ADR 0039](./0039-authenticated-rate-limits-under-usage-policy.md) /
  [ADR 0064](./0064-native-ratelimit-bindings-for-authenticated-counters.md) rate-limit semantics
  and `Retry-After`, and [ADR 0034](./0034-unified-scope-model-across-actors.md) scopes are preserved; the
  runtime centralizes how they are applied, not what they mean.
- OpenAPI generation still reads the same contracts; folding the generator's hardcoded paths onto
  the now-authoritative contract paths is a separate follow-up, not this ADR.

## Follow-Ups

- Fold the OpenAPI generator's hardcoded paths onto the authoritative contract paths.
- Consider mounting `admin` routes (currently on `api`) through the same registrar once the
  operator-identity work ([ADR 0046](./0046-operator-identity-and-web-admin-surface.md),
  [ADR 0067](./0067-interim-production-security-baseline-before-app-service.md)) resumes.
- Implementation is tracked in [`docs/ops/worker-runtime-todo.md`](../ops/worker-runtime-todo.md).
