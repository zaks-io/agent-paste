# Analytics Runbook

Two product-analytics surfaces, both on Cloudflare:

1. **Workers Analytics Engine** — custom `publish` and `read` events on artifacts, written from the `api` and `content` Workers. This is application/product telemetry, distinct from the infra logs/traces that flow to Axiom via [Logpush](./runbook-logpush.md).
2. **Cloudflare Web Analytics** — a cookieless RUM beacon on the human web app (`apps/web`).

## 1. Workers Analytics Engine (artifact events)

### Wiring (already in the repo)

- Shared helper: `packages/worker-runtime/src/analytics.ts` (`writeArtifactEvent`). Fire-and-forget: a missing binding is a no-op and any write error is swallowed, so analytics can never break a publish or a read.
- `api` emits `publish` in `apps/api/src/routes/revisions.ts` (only on a fresh publish, never on an idempotent replay).
- `content` emits `read` in `apps/content/src/serve-object.ts` (once per served object/bundle, GET and HEAD).
- Binding `ARTIFACT_EVENTS` is declared in both `wrangler.jsonc` files for `dev`, `preview`, and `production`. Both Workers point at the **same** dataset per environment so publish and read land together:
  - `agent_paste_artifact_events_preview`
  - `agent_paste_artifact_events_production`

No Cloudflare dashboard setup is needed — Analytics Engine datasets are created on first write. Querying requires an account API token with **Account Analytics: Read**.

### Data-point shape

| Field     | Meaning                                                       |
| --------- | ------------------------------------------------------------- |
| `index1`  | `workspace_id` (the one allowed index; per-workspace rollups) |
| `blob1`   | event kind: `publish` or `read`                               |
| `blob2`   | `artifact_id`                                                 |
| `blob3`   | `revision_id`                                                 |
| `blob4`   | detail: publish → `ephemeral`/`standard`; read → `get`/`head` |
| `double1` | bytes served (read only; `0` for publish)                     |

`timestamp` and `_sample_interval` are added by Analytics Engine.

### Example queries (SQL API)

Query via `POST https://api.cloudflare.com/client/v4/accounts/{account_id}/analytics_engine/sql` with the API token.

Publishes per day (last week):

```sql
SELECT toStartOfDay(timestamp) AS day, sum(_sample_interval) AS publishes
FROM agent_paste_artifact_events_production
WHERE blob1 = 'publish' AND timestamp > now() - INTERVAL '7' DAY
GROUP BY day ORDER BY day
```

Reads and bytes served per workspace (last day):

```sql
SELECT index1 AS workspace, sum(_sample_interval) AS reads, sum(double1 * _sample_interval) AS bytes
FROM agent_paste_artifact_events_production
WHERE blob1 = 'read' AND timestamp > now() - INTERVAL '1' DAY
GROUP BY workspace ORDER BY reads DESC LIMIT 25
```

Ephemeral vs standard publish split:

```sql
SELECT blob4 AS tier, sum(_sample_interval) AS publishes
FROM agent_paste_artifact_events_production
WHERE blob1 = 'publish' AND timestamp > now() - INTERVAL '30' DAY
GROUP BY tier
```

### Notes

- `_sample_interval` weights each row; always `sum(_sample_interval)` for counts, never `count()`. Analytics Engine samples under high write volume.
- Publish records no byte count: the publish result does not carry a reliable plaintext size at that point, and threading one through the DB layer was out of scope. Bytes are captured exactly on the read path. If publish-time size becomes important, add `size_bytes` to the publish result in `packages/db` and pass it into the `publish` event.

## 2. Cloudflare Web Analytics (beacon)

### Wiring (already in the repo)

- Component: `apps/web/src/components/web-analytics-beacon.tsx`. Server-renders the official `static.cloudflareinsights.com/beacon.min.js` tag into `<head>`, only when a token is present.
- Token flows `CF_WEB_ANALYTICS_TOKEN` (wrangler var) → `WebEnv` → `loadRootEnv` → root route loader → `RootDocument`.
- Production token is set in `apps/web/wrangler.jsonc` (`production.vars`). The token is **public** by design (it ships in the HTML), so committing it as a var is correct — it is not a secret.
- `dev` and `preview` set the token to `""`, so the beacon renders nothing outside production.

### No Subresource Integrity (deliberate)

The beacon tag has no `integrity`/`crossorigin`. Cloudflare ships `beacon.min.js` unversioned and updates it in place; a pinned SRI hash would break the beacon the moment they push an update. The script is Cloudflare's first-party CDN (same trust boundary as the Workers), and this is the exact embed the CF dashboard generates. Adding SRI here would be a self-inflicted outage, not a hardening.

### No CSP change needed

The main web app responses have no Content-Security-Policy (only the access-link viewer/proxy paths in `apps/web/src/security-headers.ts` set a CSP, and the beacon does not render on those). If a global CSP is ever added, allow `static.cloudflareinsights.com` in `script-src` and `cloudflareinsights.com` in `connect-src`.

### Rotating / changing the site

The Web Analytics site lives in the Cloudflare dashboard (Analytics & Logs → Web Analytics). To change sites, create a new site there, copy its token, and update `production.vars.CF_WEB_ANALYTICS_TOKEN`. Data appears in that same dashboard, not in Axiom.
