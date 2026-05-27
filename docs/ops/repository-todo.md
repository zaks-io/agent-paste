# Repository core: remaining work

Source of truth for follow-ups after the repository adapters were unified behind a
backend-agnostic core in `packages/db/src/repository/`. Owner: Isaac. Snapshot date: 2026-05-23.

Scope clarification: this file tracks cleanup that was deliberately deferred so the
unification PR stayed behavior-preserving except for the three reconciliations recorded in
[ADR 0070](../adr/0070-repository-core-ports-and-adapters.md). It does not re-litigate that
design.

## Local idempotency is a resolved-value cache, not in-flight serialization

`packages/db/src/repository/local-unit-of-work.ts` stores `idempotencyKey -> resolved value`.
The first call runs the handler and caches the result; replays return it. Two concurrent
calls with the same key both miss the cache and both run the handler, because nothing is
stored until the first one resolves.

The Postgres backend does not have this gap: `runCommand` claims the idempotency record
inside the transaction, so an in-flight collision raises `IdempotencyInFlightError` and the
Worker returns 409.

- [x] Make `LocalUnitOfWork` store an in-flight promise keyed by the command key, await it on
      collision, and only cache the terminal value once it resolves. A rejected handler must
      evict the key so a later retry can run.
- [x] Decide whether a same-key collision while a handler is still running should reject with
      an in-flight error (matching Postgres 409 semantics) or coalesce onto the same promise. The
      local backend powers `pnpm dev:all` and the in-memory test harness, so the choice only has
      to be faithful enough that worker tests asserting 409 behavior can run against it if they
      ever need to.

## `peekReplay` only sees committed local results

`LocalUnitOfWork.peekReplay` reads the same resolved-value map, so it cannot report an
in-flight command as in-flight. This is the read-side of the item above and is fixed by the
same change.

- [x] Once in-flight tracking lands, have `peekReplay` distinguish "no record", "in-flight",
      and "completed with result". `apps/upload` currently only branches on completed-with-result
      versus null, so this is forward-looking, not a current bug.

## `RepositoryCore` is one large file

`packages/db/src/repository/core.ts` is ~700 lines because it now holds every method's domain
orchestration in one place, which is the point of the unification. It is over the usual
~300-line house guideline.

- [ ] If it keeps growing, split by surface area (admin/cleanup, upload-session lifecycle,
      web-member provisioning, public agent view) into sibling modules that the core composes,
      without reintroducing a second copy of any orchestration. Do not split per backend.

## Upload Session lifecycle is still split across repository and upload Worker

The current upload path intentionally keeps the repository responsible for durable Upload Session
state transitions while `apps/upload` observes R2 state, mints signed URLs, and shapes the Worker
response. That is workable for the MVP, but the lifecycle language is now visible in two places:
session creation/finalization in `RepositoryCore`, and signed upload URL / R2 observation behavior
in the upload Worker.

- [x] When Phase 4 publish/update work begins, deepen this into an Upload Session lifecycle
      module that owns the domain sequence and response shape while keeping R2 and signing as
      ports. Do not move backend orchestration into adapters.
      (`packages/db/src/repository/upload-session-lifecycle.ts`,
      `packages/db/src/upload-session-lifecycle.ts`)

## `deleted_r2_objects` is not part of the idempotent delete result

`deleteArtifact` in `apps/api/src/index.ts` wraps `db.deleteArtifact` (which claims the
idempotency key and replays the stored DB result) but computes `deleted_r2_objects` from a
`purgeArtifactBytes` call that runs _outside_ that idempotent boundary. The first call returns
the real purge count; a retry with the same key replays the DB result but re-runs the purge,
which now finds nothing and returns 0. So the replayed payload differs from the original.

This predates the repository unification (the purge-then-merge shape came from #24, commit
22c4b36; the unification only swapped `dbWithDeleteArtifact` for `db`). R2 purge accounting
lives in the Worker on purpose: `runCleanup` likewise always reports `deleted_r2_objects: 0`
and leaves object deletion to the jobs path. Reconciling that is a behavior change to delete
semantics, deliberately out of scope for the behavior-preserving unification.

- [ ] Decide where the authoritative R2 purge count lives: either compute it inside the
      idempotent command (persist it on the operation event / command result so replays return
      the same number), or document that `deleted_r2_objects` is best-effort and not replay-stable.
- [ ] If it becomes replay-stable, add a test that issues the same delete idempotency key twice
      and asserts identical `deleted_r2_objects` across both responses.
- [x] When the jobs worker takes over byte purge, deepen deletion/invalidation into an API-side
      module that owns denylist writes, purge job enqueueing, and replay accounting as one
      explicit side-effect boundary (AP-40).
