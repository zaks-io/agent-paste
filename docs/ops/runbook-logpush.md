# Logpush to Axiom Runbook

Click-ops runbook for wiring Cloudflare Workers Logpush into Axiom for `api`, `upload`, and `content`. Drives ADR 0011 and backlog item #6 in [`project-status.md`](./project-status.md).

Scope:

- Six Workers (preview + production for each of `api`, `upload`, `content`).
- One Axiom dataset per Worker per environment (six total).
- One Logpush job per Worker per environment (six total).
- Three Axiom dashboard panels: 5xx rate, p95 latency, request count by route.

Out of scope:

- `jobs`, `web`, `mcp` Workers (scaffolds only, no business logic per `project-status.md`).
- Marketing `apex` Worker (low-value logs, defer).
- Tail Workers, R2 access logs, audit-event ingestion (separate runbooks).

## Pre-flight

### Cloudflare

- [ ] Logged into the `zaks-io` Cloudflare account (`a461d640900eb3905d7b6619c8c0da91`). `wrangler whoami` confirms.
- [ ] Workers Paid plan active (Logpush requires it; already confirmed in `project-status.md` § Cloudflare).
- [ ] All six Worker names exist and are deployed:
  - `agent-paste-api-preview`, `agent-paste-api-production`
  - `agent-paste-upload-preview`, `agent-paste-upload-production`
  - `agent-paste-content-preview`, `agent-paste-content-production`
- [ ] Confirm each Worker has `observability.enabled = true` in its `wrangler.jsonc` (already true for all three apps as of 2026-05-21).
- [ ] Account-level permission `Logs Edit` available on the API token used for the Logpush job (token under `CLOUDFLARE_API_TOKEN` already has Worker/R2/KV/Hyperdrive deploy scopes; Logs Edit may need to be added).

### Axiom

- [ ] Axiom workspace selected (use the same org that already holds existing zaks-io datasets, per MEMORY).
- [ ] An ingest API token with `Ingest` scope for the six datasets below (create one shared token, do not reuse Axiom admin tokens).
- [ ] Decide retention up-front: `30d` for preview datasets, `90d` for production datasets. Retention is set at dataset-create time in Axiom and is non-trivial to change after the fact.

## Axiom datasets

Create six datasets in Axiom. Names match the Worker names so Logpush filtering is one-to-one.

| Dataset                          | Retention | Source Worker                    |
| -------------------------------- | --------- | -------------------------------- |
| `agent-paste-api-preview`        | 30d       | `agent-paste-api-preview`        |
| `agent-paste-api-production`     | 90d       | `agent-paste-api-production`     |
| `agent-paste-upload-preview`     | 30d       | `agent-paste-upload-preview`     |
| `agent-paste-upload-production`  | 90d       | `agent-paste-upload-production`  |
| `agent-paste-content-preview`    | 30d       | `agent-paste-content-preview`    |
| `agent-paste-content-production` | 90d       | `agent-paste-content-production` |

No explicit field schema needed; Axiom auto-detects from the first `workers_trace_events` payload. Axiom uses `_time` from the event timestamp automatically.

## Cloudflare Logpush jobs

One job per Worker per environment. Dataset (Cloudflare side) is always `workers_trace_events`. Destination is Axiom HTTPS ingest:

```
https://api.axiom.co/v1/datasets/<axiom-dataset>/ingest?timestamp-field=EventTimestampMs&timestamp-format=unixmilli
```

Auth: `Authorization: Bearer <AXIOM_INGEST_TOKEN>` on the Logpush destination URL via the `header_Authorization` URL parameter (Cloudflare-supported pattern). Use the same Axiom token across all six jobs.

Job configuration matrix:

| Job name                   | Worker filter (`script_name`)    | Axiom dataset                    |
| -------------------------- | -------------------------------- | -------------------------------- |
| `axiom-api-preview`        | `agent-paste-api-preview`        | `agent-paste-api-preview`        |
| `axiom-api-production`     | `agent-paste-api-production`     | `agent-paste-api-production`     |
| `axiom-upload-preview`     | `agent-paste-upload-preview`     | `agent-paste-upload-preview`     |
| `axiom-upload-production`  | `agent-paste-upload-production`  | `agent-paste-upload-production`  |
| `axiom-content-preview`    | `agent-paste-content-preview`    | `agent-paste-content-preview`    |
| `axiom-content-production` | `agent-paste-content-production` | `agent-paste-content-production` |

### Field selection

Cloudflare Logpush exposes the `workers_trace_events` schema. Select **only** these fields. The intent is to keep enough signal for 5xx rate + p95 latency + request-count-by-route dashboards while excluding PII and secret material.

Common fields (all six jobs):

- `Outcome`
- `EventTimestampMs`
- `ScriptName`
- `ScriptVersion.Id`
- `DispatchNamespace` (will be empty; included for future use)
- `Logs` (subset: `Level`, `Message`, `TimestampMs`; truncate `Message` at 2KB if Axiom supports per-field truncation, else leave default)
- `Exceptions` (subset: `Name`, `Message`, `TimestampMs`)
- `CPUTimeMs`
- `WallTimeMs`
- `Event.Request.Method`
- `Event.Request.URL` (see redaction rule below; Logpush itself cannot strip query strings, so this is redacted at the Axiom query layer and by Worker-side logging hygiene)
- `Event.Response.Status`

Explicitly **exclude**:

- `Event.Request.Headers` (would leak `Authorization`, `Cookie`, `X-API-Key`, `Idempotency-Key`).
- `Event.Request.Cf` (geolocation + TLS info; not needed for current dashboards).
- `Event.Request.Body` (Logpush does not capture bodies for `workers_trace_events`; explicitly omit if ever exposed).
- `Event.RayID` if Axiom dataset cost is a concern; otherwise keep for tracing.

Sample rate: `1` (100%). Revisit once we have a sense of monthly Axiom ingest cost; budget alert at $25/month preview, $100/month production.

### Redaction

Logpush cannot rewrite field values; redaction must happen at the Worker logging layer (already in place for structured logs) and via Axiom-side dataset transformations.

Drop or never-log (Worker code is already responsible; this is the operator's denylist when reviewing logs and writing dashboards):

- HTTP headers: `Authorization`, `Cookie`, `X-API-Key`, `X-Admin-Token`, `Idempotency-Key`.
- Query params on signed URLs: `token`, `kid`, `expires` (these appear in `Event.Request.URL` and **will** show up in Axiom; treat URL field as low-trust and redact in dashboard queries).
- Request bodies: never logged. Worker logs include the route + status, not the payload.
- Secrets that must never appear in any log line (from `project-status.md` § Worker secrets):
  - `CONTENT_SIGNING_SECRET`
  - `UPLOAD_SIGNING_SECRET`
  - `API_KEY_PEPPER_V1`
  - `ADMIN_TOKEN`, `ADMIN_TOKEN_HASH`
- API key material: full `ap_pk_*` strings. The structured logger already truncates to a `prefix` only; verify the truncation by spot-checking the Axiom dataset after first ingest.
- Operator email addresses from `OPERATOR_EMAILS`: never log on the request path.

If any of the above appear in Axiom after first ingest, treat it as a P1 and rotate the leaked secret per ADR 0045.

## Axiom dashboard panels

Create one dashboard per environment (`agent-paste preview` and `agent-paste production`). Each dashboard has three panels. Paste the APL queries below verbatim; swap the dataset name per panel and per environment.

### Panel 1: 5xx rate per Worker (last 1h, 1-minute bins)

```apl
union
  ['agent-paste-api-production'],
  ['agent-paste-upload-production'],
  ['agent-paste-content-production']
| where _time > ago(1h)
| extend status = toint(['Event.Response.Status'])
| extend is_5xx = iff(status >= 500, 1, 0)
| summarize total = count(), errors = sum(is_5xx) by bin(_time, 1m), ['ScriptName']
| extend rate_5xx = todouble(errors) / todouble(total)
| project _time, ['ScriptName'], rate_5xx
```

### Panel 2: p95 wall-time latency per Worker (last 1h, 1-minute bins)

```apl
union
  ['agent-paste-api-production'],
  ['agent-paste-upload-production'],
  ['agent-paste-content-production']
| where _time > ago(1h)
| summarize p95_ms = percentile(['WallTimeMs'], 95) by bin(_time, 1m), ['ScriptName']
| project _time, ['ScriptName'], p95_ms
```

### Panel 3: request count by route (last 1h)

URL is treated as untrusted; this query strips query strings before grouping so signed-URL tokens never appear in the panel axis.

```apl
union
  ['agent-paste-api-production'],
  ['agent-paste-upload-production'],
  ['agent-paste-content-production']
| where _time > ago(1h)
| extend url = tostring(['Event.Request.URL'])
| extend path = tostring(split(url, "?")[0])
| summarize requests = count() by ['ScriptName'], path
| order by requests desc
| take 50
```

Preview dashboard: copy the three queries above, swap the three `*-production` dataset names for the matching `*-preview` names.

## Verification

After Logpush jobs are enabled and the first batch flushes (Cloudflare batches every ~5 minutes), generate traffic and confirm ingest.

### 1. Generate preview traffic

Hits the public Agent View on preview (no auth required). Replace `<view-token>` with one minted via `pnpm smoke:preview` output, or call the published smoke fixture.

```sh
for i in $(seq 1 20); do
  curl -fsS -o /dev/null -w "%{http_code}\n" \
    "https://usercontent.preview.agent-paste.sh/v/<view-token>/README.md"
done

curl -fsS -o /dev/null -w "%{http_code}\n" \
  "https://api.preview.agent-paste.sh/v1/healthz"
```

Force a 5xx for the error-rate panel by hitting a guaranteed-bad signed URL:

```sh
curl -s -o /dev/null -w "%{http_code}\n" \
  "https://usercontent.preview.agent-paste.sh/v/invalid-token/x"
```

### 2. Confirm Axiom ingest

Run in the Axiom query bar against `agent-paste-content-preview`:

```apl
['agent-paste-content-preview']
| where _time > ago(15m)
| summarize events = count(), workers = dcount(['ScriptName'])
```

Pass criteria:

- `events > 0` within 10 minutes of the curl loop.
- `workers == 1` (just the content Worker for this dataset).

Spot-check that no banned fields landed:

```apl
['agent-paste-content-preview']
| where _time > ago(15m)
| extend url = tostring(['Event.Request.URL'])
| where url contains "Authorization=" or url contains "ap_pk_"
| count
```

Must return `0`. If non-zero: pause the Logpush job, file an incident, and rotate the leaked credential.

### 3. Repeat for production

Use a real artifact `view-token` from a production smoke run (`AGENT_PASTE_PRODUCTION_ADMIN_TOKEN=... pnpm smoke:production`) and run the same APL against `agent-paste-content-production`.

## Done criteria

Item #6 in `project-status.md` is Done when:

- All six Logpush jobs are listed and `enabled: true`.
- All six Axiom datasets receive events with `_time > ago(15m)` after a traffic burst.
- Both dashboards render non-empty panels.
- Field-banlist APL queries (above) return `0` rows.

When closing: update `project-status.md` § ADR 0011 row to `Done` and move item #6 to the Recently Completed section with a link back to this runbook.
