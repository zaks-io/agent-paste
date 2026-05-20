# Workspace Isolation via Postgres RLS

Every tenant table in the Hyperdrive-backed Postgres database enables Row-Level Security with a policy that scopes reads and writes to one **Workspace** at a time. At request entry, every authenticated path in `api`, `upload`, and `jobs` runs `SET LOCAL app.workspace_id = $1` immediately after auth resolves the actor and before any tenant query. The DB role used by application Workers cannot bypass RLS. A separate elevated role exists for explicit platform-level operations and is reached only through a `withPlatformContext()` wrapper that records its use. The model treats tenant isolation as a database invariant, not as a code-review convention.

## Considered Options

- **Code-review discipline only.** Cheapest, no infrastructure. Every query that touches tenant data must include `WHERE workspace_id = ?`. One forgotten clause is silent cross-tenant leakage, and the platform's primary security boundary becomes "the developer remembered." Rejected for a solo-dev MVP where the same person writes and reviews the code.
- **App-layer tenant context only.** Extend `runCommand` (ADR 0004) to require a workspace context and inject `WHERE workspace_id = ?` into every query it touches. Catches transactional writes, but reads outside `runCommand` and any ad-hoc query path bypass the guard. Rejected as a sole defense.
- **Postgres RLS only.** Database-level enforcement. Impossible to bypass from the application DB role even if a query forgets its WHERE clause. Operational complexity (RLS debugging, policy maintenance, role separation) is real but bounded.
- **RLS plus an app-layer convention (chosen).** RLS is the runtime safety net; setting `app.workspace_id` exactly once at auth and inheriting it for every query is the ergonomic path. Belt and braces.

## Consequences

- **RLS enabled on every tenant table** including `artifacts`, `revisions`, `upload_sessions`, `access_links`, `api_keys`, `audit_events`, `safety_warnings`, `idempotency_records`, `platform_lockdowns`. Each policy is `USING (workspace_id = current_setting('app.workspace_id', true)::uuid)` with the same predicate on `WITH CHECK` for inserts and updates.
- **App role separation.** The application DB role used by Workers via Hyperdrive has `NOBYPASSRLS`. A separate `platform_admin` role has `BYPASSRLS` and is used only by the explicit `withPlatformContext()` wrapper and by `jobs` paths that legitimately sweep across workspaces (retention sweeps, upload cleanup, byte purge). Use of the elevated role is logged.
- **Setting workspace context.** Every authenticated request, after the `requireScopes` middleware from ADR 0034 resolves the actor, calls `SET LOCAL app.workspace_id = $1` on the transaction before any tenant query. The setting is transaction-scoped (`LOCAL`) so connection pooling through Hyperdrive does not leak workspace identity across requests.
- **Failure mode.** A query that runs without `app.workspace_id` set returns zero rows because the RLS predicate evaluates to `UNKNOWN` and is filtered. This is fail-closed: a developer mistake produces empty result sets rather than cross-tenant data. Tests assert this behavior so the safety net stays a known property.
- **`content` worker exemption.** `content` has no Hyperdrive binding (ADR 0028) and authorizes via the signed token's workspaceId, so RLS does not apply there. The token itself is the cross-tenant boundary on the unauthenticated read path.
- **Migrations and seeding.** Schema migrations run as `platform_admin`. Test seeds set `app.workspace_id` per workspace fixture so seeded rows land under the right RLS predicate.
- **Performance.** RLS adds one predicate per tenant query. Composite indexes that lead with `workspace_id` keep the planner happy. No measurable cost at MVP scale.
- **Joins.** Cross-table joins inherit the RLS predicate on each joined table. Tables that legitimately reference platform-controlled data without a `workspace_id` (e.g., a future `platform_settings` table) do not enable RLS.
- **Testing convention.** Integration tests run against a real Postgres with RLS on. Each test sets `app.workspace_id` explicitly; tests that forget see empty rows and fail loudly. Matches the team's broader convention of not mocking the database in integration tests.
- **No CONTEXT.md change.** Tenant isolation is enforcement, not domain language. The **Workspace** glossary term already defines the boundary; this ADR pins how the boundary is enforced.
