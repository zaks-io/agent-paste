# Live Updates — remaining work

Source of truth for the Live Updates feature decided in [ADR 0069](../adr/0069-live-updates-via-stream-worker-and-per-artifact-durable-object.md). Owner: Isaac. Snapshot date: 2026-05-27.

Scope: implemented in AP-25 (`apps/stream`, api notify/authorize, web SSE proxies). Remaining polish is operator tunability for the viewer cap and hosted-route cutover.

## Dependencies

- [x] Phase 4 multi-revision **Artifacts** (ADR 0048 revisions piece, ADR 0053).
- [x] Latest-moving **Share Links**.
- [x] Phase 3 dashboard artifact detail viewer and `/al/{publicId}` Access Link viewer.

## `stream` Worker

- [x] Create `apps/stream` with a per-**Artifact** Durable Object keyed `idFromName(artifactId)`.
- [x] No Postgres, R2, or KV binding; no secrets; serves no **Untrusted Content**. Only a `stream -> api` Service Binding.
- [x] Durable Object holds the live connection set and the last fanned-out **Published Revision** pointer.
- [x] Add `apps/stream/wrangler.jsonc` with the Durable Object binding and migrations, per ADR 0065.

## `api` publish notify

- [x] After publish commits, notify the **Artifact** Durable Object with the new **Published Revision** pointer.
- [x] Notify is post-commit and best-effort (log + drop; no publish rollback).
- [x] Notify contract shape in `packages/contracts` (`liveUpdates.ts`).

## Connection authorization

- [x] SSE over `fetch()` + `ReadableStream`, not native `EventSource`.
- [x] Public path: blob in POST body; `stream` forwards to `api` internal authorize (ADR 0047).
- [x] Dashboard path: WorkOS bearer forwarded to `api` internal authorize (ADR 0059 / ADR 0068).
- [x] `stream` never verifies credentials itself.
- [x] Reject **Revision Link** connections on the public surface.

## Client behavior

- [x] Swap iframe `src` on new pointer (`/al/*` and dashboard artifact detail).
- [x] Reconcile-on-reconnect via initial SSE event on connect.
- [x] Live Update client lives in `apps/web/src/lib/live-updates.ts` (no session imports on `/al/*` routes).

## Cost bound and revocation

- [x] Per-artifact concurrent-viewer cap (`LIVE_UPDATE_VIEWER_CAP = 10` in contracts).
- [x] At-cap refusal returns 503 `live_update_at_cap` (client treats as unavailable and keeps current iframe).
- [x] Proactive drop on artifact deletion and platform lockdown (workspace lockdown fans out to active artifacts).
- [ ] Access Link Lockdown disconnect hook when workspace lockdown API for access links ships.
- [ ] Operator-tunable cap via hosted config (currently constant in contracts).

## Docs wiring

- [x] Add an ADR 0069 row to the ADR Coverage table in [`status/coverage.md`](./status/coverage.md) (Deferred) and reference this file from the Phase 4 backlog.
- [x] Add the `stream` Worker to [`status/implementation.md`](./status/implementation.md).
