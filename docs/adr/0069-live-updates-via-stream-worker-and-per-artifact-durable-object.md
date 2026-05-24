# Live Updates via a stream Worker and per-Artifact Durable Object

Status: Accepted.

An already-open **Private Link** or **Share Link** viewer advances to the latest **Published Revision** without a manual reload. A dedicated `stream` Worker holds one Durable Object per **Artifact** that fans out **Published Revision** pointers to connected viewers over Server-Sent Events carried on a `fetch()` stream; `apps/api` notifies the Durable Object after it commits a **Publish**, and authorizes every viewer connection on the Durable Object's behalf over a Service Binding. This is a post-MVP feature: it depends on multi-revision **Artifacts** and latest-moving **Share Links**, both currently out of MVP, and on the Phase 3 dashboard.

## Context

The agent loop is "agent edits, human looks." Today the human reloads to see new work. We want an open viewer to advance on its own when the agent **Publishes**, on both the private dashboard surface and the public viewer surface, without turning the platform into a push system that runs whether or not anyone is watching.

Three forces shaped the design:

- **The trust boundary.** A connection that stays open for the duration of a view has a different scaling and failure profile than the request/response write path. `apps/api` is the sole write authority and holds Postgres, R2, and KV. Co-locating a fan of long-lived connections there couples an availability-sensitive realtime surface to the write authority. [ADR 0006](./0006-small-workers-by-trust-and-scaling-boundary.md) already splits Workers by trust and scaling boundary.
- **The credential constraint.** The public surface authorizes with an **Access Link** credential whose blob, per [ADR 0047](./0047-access-link-signed-url-with-fragment-encoded-payload.md), must never appear in a URL path, query string, log, trace, or analytics event. A native `EventSource` is GET-only and cannot carry that blob in a request body or header, so it cannot authorize a public connection without violating ADR 0047.
- **The hosting posture.** [ADR 0048](./0048-transient-artifacts-by-default.md) treats stored content as transient to keep the platform from drifting into general-purpose web hosting. A realtime fan-out is exactly the kind of feature that invites that drift, so its cost must be bounded by design, not by hope.

## Decision

- **Surfaces.** Live Updates apply to the private dashboard viewer at `/artifacts/{artifactId}` (authorized by a **Workspace Member** session) and the public viewer at `/al/{publicId}` (authorized by an **Access Link**). On the public surface only **Share Links** qualify, because a **Share Link** tracks the latest **Published Revision**. A **Revision Link** is pinned to one **Revision** and never receives a Live Update.
- **Trigger.** Fan-out happens on any **Publish**. There is no agent-side watch session and no `watch` command; the only session that exists is the viewer's open connection. Viewers only ever observe **Published Revisions**; a **Draft Revision** never crosses the wire.
- **Topology.** A new `stream` Worker holds one Durable Object per **Artifact**, keyed `idFromName(artifactId)`. The Durable Object holds the set of live connections for that **Artifact** and the current **Published Revision** pointer it last fanned out. `stream` holds no Postgres, R2, or KV binding, carries no secrets, and serves no **Untrusted Content**; the pointer it relays is platform-controlled data.
- **Transport.** Connections use Server-Sent Events delivered over a `fetch()` request with a streamed `ReadableStream` body, not a native `EventSource`. This lets the public client send the **Access Link** blob in the request body instead of the URL, satisfying ADR 0047.
- **Connection authorization.** On connect, `stream` forwards the viewer credential to `apps/api` over a `stream -> api` Service Binding and opens the stream only after `api` confirms. The public path forwards the **Access Link** blob with the same resolve semantics as `POST /v1/access-links/resolve`; the dashboard path forwards the **Workspace Member** session per [ADR 0059](./0059-web-app-session-and-auth-forwarding-to-api.md) and [ADR 0068](./0068-workos-authkit-for-web-app-auth.md). `stream` never verifies a credential itself.
- **Publish notify.** After `apps/api` commits a **Publish**, it notifies the **Artifact**'s Durable Object so the Durable Object fans the new **Published Revision** pointer to connected viewers. The notify is post-commit; the durable write is the source of truth and the fan-out is best-effort.
- **Client behavior on update.** The client swaps the content-origin iframe (or media element) to the new **Published Revision** pointer. A viewer that fell behind reconciles to the current **Published Revision** on reconnect rather than replaying missed **Revisions**. Nothing recalls bytes already rendered in an open iframe.
- **Revocation.** On takedown the Durable Object proactively drops connections, mirroring the denylist-on-takedown write in [ADR 0057](./0057-kv-denylist-namespace-keys-and-write-order.md). The drop is selective: **Access Link Lockdown** drops public **Share Link** connections only and leaves **Private Link** connections open, because Lockdown does not affect the **Private Link**; **Platform Lockdown** and **Deletion** drop every connection.
- **Cost bound.** A low per-**Artifact** concurrent-viewer cap, platform-controlled and operator-tunable, limits held connections and fan-out cost per **Artifact**. Beyond the cap a new connection is refused and the client falls back to manual reload. The cap is a deliberate non-hosting signal: these are transient handoffs, not assets to broadcast.

## Considered Options

### Transport

- **Native `EventSource`.** Rejected. GET-only with no request body or custom headers, so it cannot carry the **Access Link** blob without putting it in the URL, which ADR 0047 forbids.
- **WebSocket with the Hibernation API.** Rejected. Bidirectional and heavier than the one-way server-to-client push we need, and Hibernation optimizes for cheaply holding many idle persistent sockets, which is the long-lived-when-nobody-is-looking pattern we explicitly do not want. We only need the connection while a viewer is actively looking.
- **SSE over `fetch()` + `ReadableStream`.** Selected. One-way push that matches the need, carries the credential in the body to satisfy ADR 0047, and reconnects cleanly with reconcile-on-reconnect semantics.

### Topology

- **Fold the connections into `api` or `content`.** Rejected. Couples an availability-sensitive long-connection surface to the write authority (`api`) or the untrusted-content origin (`content`), against ADR 0006.
- **Dedicated `stream` Worker with a per-Artifact Durable Object.** Selected. Isolates the realtime scaling profile, keeps `stream` free of durable bindings and secrets, and gives a natural per-**Artifact** fan-out point and connection-count boundary.

### Trigger

- **Client polling.** Rejected. Defeats the real-time goal and adds unauthenticated read load that fights the **Artifact Rate Limit** intent.
- **Agent-side watch session.** Rejected. Adds a server concept that lives whether or not a human is watching; we want fan-out keyed only to **Publish** and connections keyed only to an open viewer.
- **Post-commit notify from `api`.** Selected. The durable write stays the source of truth and the fan-out is a best-effort consequence of it.

## Consequences

- A new `stream` Worker and a new `stream -> api` Service Binding exist. `api` gains a post-commit notify to the **Artifact** Durable Object on **Publish**.
- The Durable Object relays only a platform-controlled **Published Revision** pointer. The viewer fetches bytes through the existing content-origin path; `stream` never proxies **Untrusted Content**.
- Reconnect-and-reconcile is the durability story for long views. Mobile and backgrounded connections that drop after minutes are expected and fine; the viewer reconciles to the current **Published Revision** when it returns.
- The per-**Artifact** concurrent-viewer cap is a new platform dial, separate from the **Artifact Rate Limit**: the rate limit bounds request rate, the viewer cap bounds concurrent held connections. It extends the ADR 0048 transient-artifact posture to connection concurrency.
- The feature depends on multi-revision **Artifacts** and latest-moving **Share Links**, both listed Out Of MVP, and on the Phase 3 dashboard. It pulls realtime infrastructure forward and cannot ship before those land.

## What this ADR does not change

- The **Access Link** resolution and fragment-encoded payload model ([ADR 0047](./0047-access-link-signed-url-with-fragment-encoded-payload.md)). Connection auth reuses resolve semantics; the blob still never appears in a URL, query, log, or trace.
- Content-origin isolation. The viewer still renders through a `sandbox` iframe that never sets `allow-same-origin`; Live Updates only change the pointer the iframe loads.
- The **Artifact Rate Limit** ([ADR 0048](./0048-transient-artifacts-by-default.md)). It is unchanged and counts unauthenticated reads; the viewer cap is a distinct concurrency control.
- Workspace isolation via RLS and the write-authority model in `api`.

## Follow-Ups

- Define the `api` post-commit notify contract to the Durable Object, including ordering and the best-effort failure mode.
- Define the SSE event shape for a **Published Revision** pointer and the reconcile-on-reconnect handshake.
- Choose the concurrent-viewer cap value, confirm operator tunability, and define the at-cap refusal the client treats as "no live updates, reload manually."
- Extend the `/al/*` lint guard so the Live Update client cannot import session modules, consistent with [ADR 0068](./0068-workos-authkit-for-web-app-auth.md) and [ADR 0059](./0059-web-app-session-and-auth-forwarding-to-api.md).
- Track deferred work in [`docs/ops/live-updates-todo.md`](../ops/live-updates-todo.md) and link it from `docs/ops/project-status.md`.
