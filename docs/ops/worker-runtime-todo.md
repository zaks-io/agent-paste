# Contract-Driven Route Registrar (`packages/worker-runtime`) — implementation todo

Tracks [ADR 0072](../adr/0072-contract-driven-route-registrar-and-guard.md). Goal: the route
registry in `packages/contracts` becomes the runtime enforcement source. Every route in `api`,
`upload`, and `content` mounts through `createRegistrar(deps).mount(contract, handler)` and a
uniform Request Guard.

Do these in order. The Worker cutovers are behavior-preserving except the two reconciliations in
the ADR.

## Steps

- [ ] **Add `rateLimit` to the Route Contract.** `"none" | "actor" | "artifact"` on
      `RouteContract` in `packages/contracts/src/routes.ts`; set it on all 26 routes from current
      behavior (api-key + web mutations `"actor"`, content GET/HEAD `"artifact"`, the rest `"none"`).
      `packages/contracts` stays pure types.
  - Done: `pnpm --filter @agent-paste/contracts check` green; OpenAPI golden unchanged (the field
    is not rendered) or regenerated intentionally.
- [ ] **Scaffold `packages/worker-runtime`.** `package.json`, `tsconfig.json`, `hono` dep.
  - Done: `pnpm --filter @agent-paste/worker-runtime typecheck` runs on an empty `src`.
- [ ] **`principal.ts`.** Discriminated `Principal` union keyed by auth kind
      (`api_key`, `admin_token`, `workos_access_token`, `signed_agent_view_token`,
      `signed_upload_url`, `signed_content_token`), each carrying its actor type, plus a
      `PrincipalFor<AuthRequirement>` map.
- [ ] **`errors.ts`.** `ERROR_STATUS: Record<ErrorCode, number>` and
      `errorResponse(code, requestId, env)`. **Reconcile the table against the current `upload` and
      `content` call-site statuses first** (cap/expiry codes), and record any intentional change.
  - Done: a test asserts every `ErrorCode` has a status and that the cap/expiry codes match the
    statuses the Workers return today.
- [ ] **`rate-limit.ts`.** Pure `applyRateLimit(contract, ctx, bindings)` over the `rateLimit`
      field; `"actor"` does actor + workspace-burst, `"artifact"` does per-artifact; fails open when a
      binding is absent.
  - Done: tests cover allowed, limited (429 + `Retry-After`), missing-binding fail-open.
- [ ] **`guard.ts`.** The internal chain: resolve principal → apply rate-limit → check scopes →
      shape idempotency header → render envelope. Fixed order; rate-limit before scope check.
- [ ] **`registrar.ts`.** `createRegistrar(deps)` with `AuthResolvers`, `.mount(contract, handler)`,
      and the `Db = void` conditional that drops the handler's `db` arg. Boot-check that every mounted
      contract's auth has a resolver.
  - Done: `pnpm --filter @agent-paste/worker-runtime check` green; a fakes-based suite drives the
    guard (auth pass/fail, scope fail, rate-limit 429, idempotency 400/409, envelope shape) with
    no Hono server.
- [ ] **Cut over `apps/content`.** Mount `content.get` / `content.head` through the registrar with
      a `signed_content_token` resolver and `"artifact"` rate-limit; handler keeps denylist + R2 serve.
      No `db`.
  - Done: content Worker tests green; behavior unchanged.
- [ ] **Cut over `apps/upload`.** Mount the upload routes; delete the inlined
      `rateLimitAuthenticatedRequest` / auth chains. Keep `runCommand` for finalize/create.
  - Done: upload Worker tests green; 429 + idempotency replay behavior unchanged.
- [ ] **Cut over `apps/api`.** Mount all `api` routes; delete the three inlined api-key chains and
      `withWebMember` (becomes a `workos_access_token` resolver yielding a Workspace Member actor).
      `web.auth.callback` stays a command route via `runCommand`.
  - Done: api Worker tests green; whoami / usage-policy / public agent-view / web routes behave
    identically.

## Exit criteria (not started)

- Every route in the three Workers mounts through the registrar; no inlined guard chain or
  `withWebMember` remains (grep clean). A route without a contract does not compile.
- The two reconciliations from ADR 0072 are settled and recorded: rate-limit-before-scope
  ordering, and the `ERROR_STATUS` table matching current statuses.
- `pnpm verify` green across all Turbo tasks; `pnpm smoke:local` and hosted smoke unchanged
  (auth, 429, idempotency 409, error envelopes all identical).
