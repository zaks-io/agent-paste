# KV Denylist Namespace, Keys, and Write Order

The Workers KV denylist referenced by [ADR 0028](./0028-signed-url-tokens-for-content-gateway-authorization.md) is one namespace bound as `DENYLIST` to `content` (read), `api` (write), and `jobs` (write). Entries live behind four key prefixes — one per entity scope — with a small value for ops diagnostics and a TTL matching the longest currently minted content-gateway token lifetime. The content Worker performs parallel KV reads for the entity IDs present in the verified token payload and denies on any non-null result, returning the generic `not_found` envelope from [ADR 0036](./0036-error-envelope-and-generic-404-boundary.md).

## Key formats

| Prefix | Key                  | Written on                                                                                                | Read by `content`                                                                                             |
| ------ | -------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `wsd:` | `wsd:{workspaceId}`  | Workspace-scope **Platform Lockdown** set                                                                 | only when the resolved content-gateway token carries `workspaceId`                                            |
| `ad:`  | `ad:{artifactId}`    | **Artifact** Deletion; Artifact-scope **Platform Lockdown**; **Access Link Lockdown** on the **Artifact** | always                                                                                                        |
| `rd:`  | `rd:{revisionId}`    | **Retention** removal of a **Revision**                                                                   | always                                                                                                        |
| `ald:` | `ald:{accessLinkId}` | **Access Link** revocation                                                                                | only when the resolved content-gateway token carries `accessLinkId` (Access Link path; never on Private Link) |

IDs use the public IDs from the rest of the platform: `workspaceId` is the **Workspace** UUID, while `artifactId`, `revisionId`, and `accessLinkId` are the prefixed IDs (`art_...`, `rev_...`, `al_...`). The CLI-first MVP token payload always carries `artifactId` and `revisionId`; `workspaceId` and `accessLinkId` are optional until the corresponding lockdown and Access Link flows mint those IDs into content tokens. `content` performs no Postgres lookup before the denylist check.

## Value payload

```json
{
  "reason": "platform_lockdown_workspace | platform_lockdown_artifact | access_link_lockdown | deletion | retention | revocation",
  "at": "2026-05-20T18:42:11Z"
}
```

`content` branches only on `value !== null`; the JSON exists for `wrangler kv:key get` introspection and for the operational log entry on `content` that records why a request was denied. The public response is the generic `not_found` envelope regardless of reason.

## TTL

Entries must live at least as long as the longest content-gateway token that could have been minted before the denylist write. In the CLI-first MVP, signed file URLs currently expire at the **Artifact** expiration time and can live up to the 90-day `max_ttl_seconds` from [ADR 0056](./0056-mvp-usage-policy-defaults-and-platform-caps.md), so `api` denylist writes use that maximum TTL. When stable app/Access Link flows remint short-lived content URLs, this TTL can narrow to the short content-token TTL without weakening deletion or revocation.

## Read pattern

`content` issues parallel KV reads per request for required artifact/revision keys and for optional workspace/access-link keys only when those IDs are present in the verified token payload:

```ts
const [ws, art, rev, al] = await Promise.all([
  workspaceId ? env.DENYLIST.get(`wsd:${workspaceId}`) : Promise.resolve(null),
  env.DENYLIST.get(`ad:${artifactId}`),
  env.DENYLIST.get(`rd:${revisionId}`),
  accessLinkId
    ? env.DENYLIST.get(`ald:${accessLinkId}`)
    : Promise.resolve(null),
]);
if (ws || art || rev || al) return notFound();
```

No precedence: any non-null entry denies the request.

## Write order

State-changing handlers on `api` and sweep handlers on `jobs` use the same ordering:

1. Commit the Postgres state change inside `runCommand` per [ADR 0035](./0035-runcommand-sequencing-and-idempotency-records.md).
2. Write the corresponding denylist key.
3. Enqueue any byte-purge job on Cloudflare Queues per [ADR 0019](./0019-cloudflare-queues-for-background-jobs.md).

A failure between step 1 and step 2 on `api` is **fail-closed**: when the `DENYLIST` binding is present, the handler returns `503 storage_unavailable` after the Postgres commit so the caller can retry the same idempotent operation and re-attempt the denylist write. There is no `jobs` cron sweep for access-link revocation or access-link lockdown denylist keys; byte-purge recovery sweeps in [ADR 0050](./0050-bundle-availability-and-asymmetric-dlq-consumption.md) cover deletion enqueue only. Once written, denylist entries still live for the maximum currently minted content-token lifetime described above; the accepted revocation consistency window is limited to KV/cache propagation, not a shorter entry TTL.

## Bindings

KV does not enforce read/write separation; direction is code discipline.

| Worker    | Binding name | Direction  |
| --------- | ------------ | ---------- |
| `content` | `DENYLIST`   | read only  |
| `api`     | `DENYLIST`   | write only |
| `jobs`    | `DENYLIST`   | write only |

Each environment (`production`, `preview`) has its own KV namespace ID; the binding name `DENYLIST` is shared so per-worker code is environment-agnostic.

## Not in this ADR

- KV namespace IDs (live in `wrangler.jsonc`, not in ADRs).
- Cron rediscovery handler details (covered by [ADR 0049](./0049-jobs-handler-patterns.md), [ADR 0050](./0050-bundle-availability-and-asymmetric-dlq-consumption.md)).
- Multi-region replication. Workers KV's global semantics are accepted as-is.
