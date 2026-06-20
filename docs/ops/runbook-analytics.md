# Analytics Runbook

Three product-analytics surfaces, all on Cloudflare:

1. **Workers Analytics Engine artifact events** — custom `publish` and `read` events on artifacts, written from the `api` and `content` Workers. This is application/product telemetry, distinct from the infra logs/traces that flow to Axiom via [Logpush](./runbook-logpush.md).
2. **Workers Analytics Engine funnel events** — claim-code-attributed funnel events across marketing prompt copy, ephemeral provision, ephemeral publish, and claim.
3. **Cloudflare Web Analytics** — a cookieless RUM beacon on the human web app (`apps/web`) and apex marketing site (`apps/apex`).

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

## 2. Workers Analytics Engine (funnel events)

### Wiring (already in the repo)

- Shared helper: `packages/worker-runtime/src/analytics.ts` (`writeFunnelEvent`). Fire-and-forget, same failure behavior as artifact events.
- `apps/apex` emits `prompt_copied` through `POST /__funnel/events` when the hero prompt is copied and optional analytics are allowed.
- `apps/api` emits server-side lifecycle events for ephemeral provision, publish, unlisted-link resolve, and claim.
- `apps/web` preserves the claim token from `/claim#<claim_token>` across the auth redirect and submits only the token during claim.
- `apps/cli` accepts `--claim-code <clm_...>` and forwards it to provision and publish. The API embeds it in the claim token for claim conversion attribution; CLI output never includes `claim_code` separately.
- Binding `FUNNEL_EVENTS` is declared in `apps/apex/wrangler.jsonc` and `apps/api/wrangler.jsonc` for `dev`, `preview`, and `production`. Both Workers point at the same dataset per environment:
  - `agent_paste_funnel_events_preview`
  - `agent_paste_funnel_events_production`

No Cloudflare dashboard setup is needed. Analytics Engine datasets are created on first write after the binding exists. Querying requires an account API token with **Account Analytics: Read**.

### Claim Code

`claim_code` is an optional analytics correlation ID, not an auth token, idempotency key, claim token, or billing identifier. The public shape is `clm_` plus a 26-character Crockford ULID body. It can appear in:

- the copied marketing prompt as `--claim-code <clm_...>`;
- `POST /v1/ephemeral/provision` as `claim_code`;
- the publish request header `X-Agent-Paste-Claim-Code`;
- inside the opaque Claim Token bearer returned by provision.

It must not appear as a URL query parameter, in `unlisted_url`, in `claim_url`,
in Access Link resolve requests, in claim requests, or in CLI JSON output.

Missing or invalid claim codes must not block provision, publish, link open, or claim. Invalid public inputs are ignored or rejected only on the telemetry endpoint.

### Events

| Event                              | Surface | Meaning                                                                   |
| ---------------------------------- | ------- | ------------------------------------------------------------------------- |
| `prompt_copied`                    | `apex`  | Visitor copied a claim-code-attributed marketing prompt.                  |
| `ephemeral_provision_started`      | `api`   | API received a provision request and returned or evaluated a challenge.   |
| `ephemeral_workspace_created`      | `api`   | Provision succeeded and minted the Ephemeral Workspace plus Claim Token.  |
| `ephemeral_provision_rate_limited` | `api`   | Durable Object provision gate denied the request.                         |
| `ephemeral_provision_unavailable`  | `api`   | Provision gate was unavailable or invalid and the route failed closed.    |
| `ephemeral_publish_created`        | `api`   | First publish finalized on an Ephemeral Workspace.                        |
| `ephemeral_link_opened`            | `web`   | Generated unlisted Share Link resolved successfully.                      |
| `link_claimed`                     | `api`   | A Claim Token reparented Artifacts into the claimer's Personal Workspace. |

### Data-point shape

| Field     | Meaning                                                         |
| --------- | --------------------------------------------------------------- |
| `index1`  | `claim_code` when present, else `workspace_id`, else event kind |
| `blob1`   | event kind                                                      |
| `blob2`   | surface: `apex`, `api`, `web`, or `cli`                         |
| `blob3`   | `claim_code`                                                    |
| `blob4`   | `workspace_id`                                                  |
| `blob5`   | `artifact_id`                                                   |
| `blob6`   | `claim_token_id`                                                |
| `blob7`   | `prompt_variant`, currently populated only on `prompt_copied`   |
| `blob8`   | status or reason                                                |
| `double1` | event count, always `1` before sampling                         |
| `double2` | artifact count, populated for claim events                      |

`timestamp` and `_sample_interval` are added by Analytics Engine.

### Example queries (SQL API)

Funnel by stage (last week):

```sql
SELECT blob1 AS event, sum(_sample_interval * double1) AS events
FROM agent_paste_funnel_events_production
WHERE timestamp > now() - INTERVAL '7' DAY
GROUP BY event
ORDER BY events DESC
```

Claim-code path inspection:

```sql
SELECT timestamp, blob1 AS event, blob2 AS surface, blob4 AS workspace_id, blob5 AS artifact_id, blob8 AS status
FROM agent_paste_funnel_events_production
WHERE blob3 = 'clm_01K2P8Y2S3T4V5W6X7Y8Z9ABCD'
ORDER BY timestamp
```

Prompt variant conversion:

```sql
SELECT
  prompt_variant,
  sum(copied) AS copied,
  sum(published) AS published,
  sum(opened) AS opened,
  sum(claimed) AS claimed
FROM (
  SELECT
    index1 AS claim_code,
    max(blob7) AS prompt_variant,
    sumIf(_sample_interval * double1, blob1 = 'prompt_copied') AS copied,
    sumIf(_sample_interval * double1, blob1 = 'ephemeral_publish_created') AS published,
    sumIf(_sample_interval * double1, blob1 = 'ephemeral_link_opened') AS opened,
    sumIf(_sample_interval * double1, blob1 = 'link_claimed') AS claimed
  FROM agent_paste_funnel_events_production
  WHERE timestamp > now() - INTERVAL '30' DAY
  GROUP BY claim_code
)
WHERE prompt_variant != ''
GROUP BY prompt_variant
ORDER BY copied DESC
```

### Notes

- `_sample_interval` weights each row; always use it for counts.
- Prompt variant is vendor-neutral and intentionally recorded at copy time only. LaunchDarkly can own variant assignment later without changing the Analytics Engine column contract.
- `prompt_copied` respects the optional analytics preference. Server-side lifecycle events are product telemetry and are not controlled by the optional Web Analytics toggle.

## 3. Cloudflare Web Analytics (beacon)

### Wiring (already in the repo)

- Dashboard helper: `apps/web/src/lib/analytics-scripts.ts`. The root loader passes the token only when optional analytics are allowed, then TanStack renders the official `static.cloudflareinsights.com/beacon.min.js` tag into `<head>`.
- Apex helper: `apps/apex/src/app/Shell.tsx`. The prerendered static HTML includes the beacon when a token is present; `apps/apex/src/server.ts` strips that beacon from opted-out HTML responses with `HTMLRewriter`.
- Token flows from `CF_WEB_ANALYTICS_TOKEN` (wrangler var). Production tokens are set in `apps/web/wrangler.jsonc` and `apps/apex/wrangler.jsonc`. The token is public by design (it ships in the HTML), so committing it as a var is correct; it is not a secret.
- `dev` and `preview` set the token to `""`, so the beacon renders nothing outside production.

### Privacy preferences

- `Sec-GPC: 1` disables optional Cloudflare Web Analytics.
- `DNT: 1` also disables optional Cloudflare Web Analytics as a courtesy, even though DNT is deprecated.
- `agp_analytics=off` is the first-party, shared site preference cookie. It is scoped like `agp_theme`, so a choice on `agent-paste.sh` applies to `app.agent-paste.sh` and preview subdomains.
- `agp_analytics=on` re-enables optional web analytics only when no browser-level GPC/DNT signal is active.
- Both apex and web serve `/.well-known/gpc.json` with `{ "gpc": true, "lastUpdate": "2026-06-14" }`.
- The preference controls only the optional Cloudflare Web Analytics beacon and the optional apex `prompt_copied` funnel event. It does not disable authentication/session cookies, theme preference cookies, security logs, abuse-prevention records, billing records, audit events, Sentry error monitoring, Artifact publish/read telemetry, or server-side claim-code lifecycle telemetry in Workers Analytics Engine.

### No Subresource Integrity (deliberate)

The beacon tag has no `integrity`/`crossorigin`. Cloudflare ships `beacon.min.js` unversioned and updates it in place; a pinned SRI hash would break the beacon the moment they push an update. The script is Cloudflare's first-party CDN (same trust boundary as the Workers), and this is the exact embed the CF dashboard generates. Adding SRI here would be a self-inflicted outage, not a hardening.

### CSP

- `apps/web` uses a nonce-based strict CSP. The beacon is declared through TanStack `head().scripts` so `<HeadContent>` stamps the nonce.
- `apps/apex` allows `https://static.cloudflareinsights.com` in `script-src` and `https://cloudflareinsights.com` in `connect-src`.

### Rotating / changing the site

The Web Analytics site lives in the Cloudflare dashboard (Analytics & Logs → Web Analytics). To change sites, create a new site there, copy its token, and update `production.vars.CF_WEB_ANALYTICS_TOKEN`. Data appears in that same dashboard, not in Axiom.
