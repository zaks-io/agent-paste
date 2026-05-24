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

- [ ] Make `LocalUnitOfWork` store an in-flight promise keyed by the command key, await it on
      collision, and only cache the terminal value once it resolves. A rejected handler must
      evict the key so a later retry can run.
- [ ] Decide whether a same-key collision while a handler is still running should reject with
      an in-flight error (matching Postgres 409 semantics) or coalesce onto the same promise. The
      local backend powers `pnpm dev:all` and the in-memory test harness, so the choice only has
      to be faithful enough that worker tests asserting 409 behavior can run against it if they
      ever need to.

## `peekReplay` only sees committed local results

`LocalUnitOfWork.peekReplay` reads the same resolved-value map, so it cannot report an
in-flight command as in-flight. This is the read-side of the item above and is fixed by the
same change.

- [ ] Once in-flight tracking lands, have `peekReplay` distinguish "no record", "in-flight",
      and "completed with result". `apps/upload` currently only branches on completed-with-result
      versus null, so this is forward-looking, not a current bug.

## `RepositoryCore` is one large file

`packages/db/src/repository/core.ts` is ~700 lines because it now holds every method's domain
orchestration in one place, which is the point of the unification. It is over the usual
~300-line house guideline.

- [ ] If it keeps growing, split by surface area (admin/cleanup, upload-session lifecycle,
      web-member provisioning, public agent view) into sibling modules that the core composes,
      without reintroducing a second copy of any orchestration. Do not split per backend.
