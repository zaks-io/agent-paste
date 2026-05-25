# Live Updates — remaining work

Source of truth for the Live Updates feature decided in [ADR 0069](../adr/0069-live-updates-via-stream-worker-and-per-artifact-durable-object.md). Owner: Isaac. Snapshot date: 2026-05-23.

Scope: this is a post-MVP feature. Nothing here is built. It is parked until its dependencies land and is not on the active Phase 3 backlog in [`status/phase-backlog.md`](./status/phase-backlog.md).

## Dependencies (this cannot start until these exist)

- [ ] Phase 4 multi-revision **Artifacts** (ADR 0048 revisions piece, ADR 0053).
- [ ] Latest-moving **Share Links** (currently Out Of MVP per `docs/specs/mvp.md`).
- [ ] Phase 3 dashboard artifact detail viewer and the `/al/{publicId}` Access Link viewer (`docs/specs/web.md`).

## `stream` Worker

- [ ] Create `apps/stream` with a per-**Artifact** Durable Object keyed `idFromName(artifactId)`.
- [ ] No Postgres, R2, or KV binding; no secrets; serves no **Untrusted Content**. Only a `stream -> api` Service Binding.
- [ ] Durable Object holds the live connection set and the last fanned-out **Published Revision** pointer.
- [ ] Add `apps/stream/wrangler.jsonc` with the Durable Object binding and migrations, per ADR 0065.

## `api` publish notify

- [ ] After `runCommand` commits a **Publish**, notify the **Artifact** Durable Object with the new **Published Revision** pointer.
- [ ] Notify is post-commit and best-effort; the durable write stays the source of truth. Define the failure mode (log + drop, no publish rollback).
- [ ] Define the notify contract shape in `packages/contracts`.

## Connection authorization

- [ ] SSE over `fetch()` + `ReadableStream`, not native `EventSource`.
- [ ] Public path: client posts the **Access Link** blob in the request body; `stream` forwards to `api` with the same semantics as `POST /v1/access-links/resolve`. Blob never in URL, query, log, or trace (ADR 0047).
- [ ] Dashboard path: forward the **Workspace Member** session per ADR 0059 / ADR 0068; `api` verifies.
- [ ] `stream` opens the stream only after `api` confirms; `stream` never verifies a credential itself.
- [ ] Only **Share Links** qualify on the public surface. Reject **Revision Link** connections (pinned, never live-update).

## Client behavior

- [ ] On a new pointer, swap the content-origin iframe (or media element) to the new **Published Revision**.
- [ ] Reconcile-on-reconnect: a viewer that fell behind jumps to current, no replay of missed **Revisions**.
- [ ] Extend the `/al/*` lint guard so the Live Update client cannot import session modules (ADR 0068 / ADR 0059).

## Cost bound and revocation

- [ ] Low per-**Artifact** concurrent-viewer cap, platform-controlled and operator-tunable. Pick the value.
- [ ] Define the at-cap refusal the client treats as "no live updates, reload manually."
- [ ] Proactive drop on takedown, mirroring the ADR 0057 denylist-on-takedown write.
- [ ] Selective drop: **Access Link Lockdown** drops public **Share Link** connections only and leaves **Private Link** connections open; **Platform Lockdown** and **Deletion** drop everything.

## Docs wiring

- [x] Add an ADR 0069 row to the ADR Coverage table in [`status/coverage.md`](./status/coverage.md) (Deferred) and reference this file from the Phase 4 backlog.
- [ ] Add the `stream` Worker to [`status/implementation.md`](./status/implementation.md) once `apps/stream` exists.
