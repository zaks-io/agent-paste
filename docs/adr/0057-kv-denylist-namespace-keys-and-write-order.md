# KV Denylist Namespace, Keys, and Write Order

The Workers KV denylist referenced by [ADR 0028](./0028-signed-url-tokens-for-content-gateway-authorization.md) is one namespace bound as `DENYLIST` to `content` (read), `api` (write), and `jobs` (write). Entries live behind four key prefixes — one per entity scope — with a small JSON value for ops diagnostics and a 15-minute TTL matching the content-gateway token TTL from [ADR 0056](./0056-mvp-usage-policy-defaults-and-platform-caps.md). The content Worker performs up to four parallel KV reads per request and denies on any non-null result, returning the generic `not_found` envelope from [ADR 0036](./0036-error-envelope-and-generic-404-boundary.md).

## Key formats

| Prefix | Key | Written on | Read by `content` |
|---|---|---|---|
| `wsd:` | `wsd:{workspaceId}` | Workspace-scope **Platform Lockdown** set | always |
| `ad:` | `ad:{artifactId}` | **Artifact** Deletion; Artifact-scope **Platform Lockdown**; **Access Link Lockdown** on the **Artifact** | always |
| `rd:` | `rd:{revisionId}` | **Retention** removal of a **Revision** | always |
| `ald:` | `ald:{accessLinkId}` | **Access Link** revocation | only when the resolved content-gateway token carries `accessLinkId` (Access Link path; never on Private Link) |

IDs use the ULID-prefixed public IDs from the rest of the platform (`ws_…`, `art_…`, `rev_…`, `al_…`). `workspaceId`, `artifactId`, and `revisionId` are derivable from the content-gateway token payload per [ADR 0028](./0028-signed-url-tokens-for-content-gateway-authorization.md), so `content` performs no Postgres lookup before the denylist check.

## Value payload

```json
{
  "reason": "platform_lockdown_workspace | platform_lockdown_artifact | access_link_lockdown | deletion | retention | revocation",
  "at": "2026-05-20T18:42:11Z"
}
```

`content` branches only on `value !== null`; the JSON exists for `wrangler kv:key get` introspection and for the operational log entry on `content` that records why a request was denied. The public response is the generic `not_found` envelope regardless of reason.

## TTL

**15 minutes.** Matches content-gateway token TTL from [ADR 0056](./0056-mvp-usage-policy-defaults-and-platform-caps.md). A token minted before the denylist write expires within 15 minutes on its own, so a longer TTL adds nothing. KV propagation latency, not entry TTL, bounds the consistency window.

## Read pattern

`content` issues up to four parallel KV reads per request:

```ts
const [ws, art, rev, al] = await Promise.all([
  env.DENYLIST.get(`wsd:${workspaceId}`),
  env.DENYLIST.get(`ad:${artifactId}`),
  env.DENYLIST.get(`rd:${revisionId}`),
  accessLinkId ? env.DENYLIST.get(`ald:${accessLinkId}`) : Promise.resolve(null),
]);
if (ws || art || rev || al) return notFound();
```

No precedence: any non-null entry denies the request.

## Write order

State-changing handlers on `api` and sweep handlers on `jobs` use the same ordering:

1. Commit the Postgres state change inside `runCommand` per [ADR 0035](./0035-runcommand-sequencing-and-idempotency-records.md).
2. Write the corresponding denylist key.
3. Enqueue any byte-purge job on Cloudflare Queues per [ADR 0019](./0019-cloudflare-queues-for-background-jobs.md).

A failure between step 1 and step 2 is recovered by the `jobs` cron rediscovery sweep referenced in the ADR 0028 README cross-reference and [ADR 0050](./0050-bundle-availability-and-asymmetric-dlq-consumption.md). The accepted consistency window is the 15-minute token TTL.

## Bindings

KV does not enforce read/write separation; direction is code discipline.

| Worker | Binding name | Direction |
|---|---|---|
| `content` | `DENYLIST` | read only |
| `api` | `DENYLIST` | write only |
| `jobs` | `DENYLIST` | write only |

Each environment (`live`, `preview`) has its own KV namespace ID; the binding name `DENYLIST` is shared so per-worker code is environment-agnostic.

## Not in this ADR

- KV namespace IDs (live in `wrangler.toml`/`wrangler.jsonc`, not in ADRs).
- Cron rediscovery handler details (covered by [ADR 0049](./0049-jobs-handler-patterns.md), [ADR 0050](./0050-bundle-availability-and-asymmetric-dlq-consumption.md)).
- Multi-region replication. Workers KV's global semantics are accepted as-is.
