# Repository Core via Ports and Adapters

Status: Accepted.

The Postgres and local in-memory repositories are unified behind one backend-agnostic
`RepositoryCore` that holds all domain orchestration. Each backend supplies only storage
primitives and a unit-of-work runner. Both `apps/api` and `apps/upload` depend on a single
`Repository` interface exported from [`@agent-paste/db`](../../packages/db), not on per-app
structural copies.

## Context

`packages/db` shipped two repositories that re-implemented the same ~26 methods:
`PostgresRepository` (~948 lines) and `LocalRepository` (~839 lines). The domain logic was
identical between them. Only two things differed: the storage calls (Drizzle queries scoped by
RLS versus `Map` reads and writes) and the wrapper that provides transactions, RLS scoping, and
durable idempotency. Every behavior change had to be written twice and kept in sync by hand,
and any drift between the two was a latent bug because the local backend powers `pnpm dev:all`
and the in-memory test harness that the Worker suites run against.

Separately, each consumer declared its own structural database type: `ApiDatabase` in
`apps/api/src/index.ts` and `UploadDatabase` in `apps/upload/src/index.ts`. Neither was the
real exported type, so both apps carried `Required<Pick<…>>` casts, `db as ApiDatabase & …`
intersections, defensive re-parsing of results through `unknown`, and per-method
`database_unavailable` 503 guards that duplicated the single binding-presence check. The
structural types could silently diverge from what the repositories actually returned.

## Decision

- Lift all domain orchestration into one `RepositoryCore` in
  [`packages/db/src/repository/core.ts`](../../packages/db/src/repository/core.ts) that
  `implements Repository`. It is the single source of truth for every method's behavior.
- Define the backend contract as two ports in
  [`packages/db/src/repository/ports.ts`](../../packages/db/src/repository/ports.ts):
  - `Entities`: a scope-bound accessor grouped by table. The Postgres adapter binds these to
    RLS-scoped Drizzle queries; the local adapter binds them to `Map` reads and writes.
  - `UnitOfWork`: `read(scope, fn)` runs a scoped query, `command(spec, fn)` wraps a mutation
    in durable idempotency, and `peekReplay(input)` returns a completed result for a prior
    command. A `RunScope` is `{ kind: "workspace"; workspaceId }` or `{ kind: "platform" }`;
    adapters translate it into RLS config (Postgres) or advisory `Map` filtering (local).
- Provide two adapters and nothing else per backend:
  - `postgres-entities` + `postgres-unit-of-work` map `read` to an RLS-scoped Drizzle
    transaction and `command` to the existing `runCommand` durable-idempotency runner;
    `peekReplay` calls the existing `peekIdempotentReplay` against the scoped executor.
  - `local-entities` + `local-unit-of-work` map `read` to direct `Map` access and `command` to
    a key-to-result idempotency cache.
- Keep `PostgresRepository` and `LocalRepository` as thin subclasses that wire their adapter to
  `RepositoryCore`. Existing import sites do not change.
- Export one `Repository` interface from `@agent-paste/db`
  ([`packages/db/src/repository/interface.ts`](../../packages/db/src/repository/interface.ts)).
  `apps/api` and `apps/upload` import it and delete their local `ApiDatabase` / `UploadDatabase`
  interfaces, the `Required<Pick<…>>` casts, the `db as … & …` intersections, the defensive
  `unknown` re-parsing, and the per-method 503 guards. The single `if (!db) return 503` binding
  check stays.
- The nested-command case (`resolveWebMember` wrapping per-user provisioning so concurrent
  first logins cannot duplicate a Personal Workspace, per [ADR 0055](./0055-signup-auto-provisions-personal-workspace-and-default-key.md))
  is expressed through `CommandRunContext.command(...)`. Postgres reuses the outer transaction
  as a savepoint; local shares the same idempotency map. This is the only place a command runs a
  nested, independently keyed command.

### Reconciliations

Unifying the two implementations forced three deliberate behavior decisions. These are the only
intended behavior changes; everything else is behavior-preserving.

1. `recordUploadedFile` takes one shape: `{ sessionId, path, objectKey?, sizeBytes?, uploadedAt }`.
   This is the Postgres superset. The local backend accepts the same input and ignores
   `objectKey` and `sizeBytes`, which it never persisted.
2. The cursor decode type in the core is `{ createdAt: Date; id }`. The wire format is unchanged:
   `btoa(JSON.stringify({ created_at, id }))`. The local store canonicalizes via `.toISOString()`
   before comparison so its ordering matches the Postgres column comparison.
3. `peekIdempotentReplay({ actor, operation, idempotencyKey })` is part of `Repository`. Postgres
   delegates to `@agent-paste/commands` `peekIdempotentReplay` against the scoped executor; local
   reads its idempotency map. `apps/upload` now calls `db.peekIdempotentReplay(...)` and the
   direct `@agent-paste/commands` `peekIdempotentReplay` plus `createHyperdriveExecutor` fallback
   are removed from its replay path. `apps/api` has no pre-peek pattern and gains none.

## Consequences

- A behavior change is written once in `RepositoryCore` and is automatically shared by both
  backends, so the dev/test harness can no longer drift from production behavior.
- `RepositoryCore` is large (~700 lines) because it now holds every method's orchestration in
  one place. That is the intended trade for a single source of truth. Splitting it by surface
  area without reintroducing a second copy of any orchestration is a tracked follow-up in
  [`docs/ops/repository-todo.md`](../ops/repository-todo.md).
- The unified core is async for every method because Postgres requires it. `LocalRepository`'s
  previously synchronous read methods are now async; in-memory tests `await` them.
- `apps/api` aligns to the `@agent-paste/db` actor types: `authenticateApiKey` returns
  `ApiKeyActor`, `authenticateAdmin` returns `AdminActor`, and web member actors come from
  `getWebMemberByWorkOsUserId`. This removed the worker-local `ApiActor` union (which had an
  optional `workspace_id`) and the casts it required.
- `getAdminWhoami` is removed. It was never part of the unified interface, was never implemented
  by either repository, and the `apps/api` endpoint always hit its `{ actor }` fallback, so the
  dead branch is gone with no behavior change.

## What this ADR does not change

- `packages/commands` and `packages/db/src/postgres/executor.ts` are untouched. The Postgres
  adapter consumes `runCommand`, `peekIdempotentReplay`, and the executor exactly as before.
- Postgres RLS scoping ([ADR 0044](./0044-workspace-isolation-via-postgres-rls.md)) and durable
  command sequencing ([ADR 0022](./0022-idempotent-mutations.md), [ADR 0035](./0035-runcommand-sequencing-and-idempotency-records.md))
  are preserved. The adapters route through the same primitives.
- The public error-envelope boundary ([ADR 0036](./0036-error-envelope-and-generic-404-boundary.md)).
  Cross-workspace reads still fail closed as `not_found`; the single binding check still returns 503.
- `apps/web`, WorkOS AuthKit ([ADR 0068](./0068-workos-authkit-for-web-app-auth.md)), and Access
  Links are untouched.

## Follow-Ups

- Make `LocalUnitOfWork` track in-flight commands instead of caching only resolved values, so
  concurrent same-key calls serialize and `peekReplay` can report in-flight state with semantics
  faithful to the Postgres 409 path. Tracked in
  [`docs/ops/repository-todo.md`](../ops/repository-todo.md).
- Split `RepositoryCore` by surface area if it keeps growing, without reintroducing per-backend
  orchestration copies.
