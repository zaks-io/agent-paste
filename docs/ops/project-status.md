# Project Status

Last updated: 2026-05-21 (OpenAPI generated from Zod with golden diff in CI).

First doc a fresh agent reads after `AGENTS.md`, `CONTEXT.md`, `docs/specs/README.md`, and `docs/adr/README.md`. Answers: what is built, what is scaffolded, where the code diverges from the ADRs/specs, what the next concrete step is.

This doc replaces `mvp-bootstrap-checklist.md`. The MVP work is one slice of a longer roadmap (`docs/specs/phases.md`); this file tracks the whole project, not just Phase 1.

## Snapshot

- `main` is at `2dff9d2 feat: wire runCommand into mutation routes (#4)`.
- Latest feature commit on `main`: `4bde837 feat(apex): add marketing worker at agent-paste.sh (#1)`.
- Three Workers (`api`, `upload`, `content`) and one CLI (`agent-paste`) are implemented and pass `pnpm smoke:local` and `pnpm smoke:preview`.
- Every mutation route in `api` and `upload` now flows through `runCommand` with durable idempotency (`packages/db/migrations/0002_idempotency_admin_ops.sql`).
- Three Workers (`jobs`, `web`, `mcp`) are Hono scaffolds only: `healthz` + `/openapi.json` + no business logic.
- GitHub Actions ran successful CI and production-deploy workflows on `main` on 2026-05-21.
- No open `t3code/*` branches remain; all were verified contained in `main` or absent from origin and closed.
- Per `docs/specs/phases.md` and `docs/adr/0066-cli-first-mvp-contract-narrowing.md`, the CLI-first MVP is the active phase; Auth0, web UI, MCP, queues, bundles, encryption are explicitly deferred.

## Verified State

| Check                   | Result        | Date       | Notes                                                                                                                                                                   |
| ----------------------- | ------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm setup:codex`      | Pass          | 2026-05-21 | Network approval required first run.                                                                                                                                    |
| `pnpm verify`           | Pass          | 2026-05-21 | 45 Turbo tasks under Node 24.15.0.                                                                                                                                      |
| `pnpm smoke:local`      | Pass          | 2026-05-21 | Used alt ports 18787-18789 because `workerd` held 8787.                                                                                                                 |
| `pnpm smoke:preview`    | Pass          | 2026-05-21 | After preview admin token was bootstrapped.                                                                                                                             |
| Production deploy       | Pass          | 2026-05-21 | GitHub Actions run `26245768366`.                                                                                                                                       |
| Security hardening pass | Pass          | 2026-05-21 | Content MIME/header hardening, API/upload rate-limit calls, admin CLI `--yes`, ADR 0067. `pnpm verify` pass under Node 25.9.0 with the expected Node 24 engine warning. |
| PR preview workflow     | Not exercised | n/a        | No open same-repo PRs since workflow added.                                                                                                                             |
| PR cleanup workflow     | Re-registered | 2026-05-22 | Renamed to `pr-preview-cleanup.yml` after the prior record's `pull_request.closed` trigger stopped firing for PRs #2--#9.                                               |

## Security Pass 2026-05-21

Closed immediately:

- `content` no longer trusts upload-supplied R2 `Content-Type`; served MIME is derived from the fixed extension allowlist and unknown extensions download as attachments.
- `content` now sends the MVP execution-policy headers, SVG strict-CSP override, `frame-ancestors 'none'`, and token-bounded cache lifetimes.
- API-key authenticated routes in `api` and `upload` call native Cloudflare rate-limit bindings when configured and return 429 envelopes with `Retry-After`.
- Legacy unsigned public Agent View tokens are disabled by default; local/dev must opt in explicitly.
- Public API JSON and browser Agent View responses use `Cache-Control: no-store`.
- Destructive admin CLI commands require `--yes`.
- [ADR 0067](../adr/0067-interim-production-security-baseline-before-app-service.md) records the interim security baseline before the app service exists.

Open security follow-ups:

- Runtime RLS is still not applied (`SET LOCAL app.workspace_id`) and workspace isolation still relies on application-layer predicates.
- Admin production identity is still the interim hashed bearer-token path. ADR 0067 requires Cloudflare Access/Auth0 operator identity before Phase 3 app/admin rollout.
- `content` still needs unauthenticated artifact-level read throttling.
- Secret rotation tooling (ADR 0045) still needs to be implemented.

## Implementation Map

| Component             | Status      | Source LOC | Tests | Key files / notes                                                                                                                                                                                                                                               |
| --------------------- | ----------- | ---------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api`            | Implemented | ~950       | Yes   | `src/index.ts`. Hono routing, `/openapi.json`, public Agent View, admin routes, scheduled cleanup, signed content URLs, denylist writes.                                                                                                                        |
| `apps/upload`         | Implemented | ~14k       | Yes   | `src/index.ts`. Session create, signed PUT, R2 writes, finalize, signed Agent View URL minting.                                                                                                                                                                 |
| `apps/content`        | Implemented | ~14k       | Yes   | `src/index.ts`. Signed content URL verification, CSP, extension content-type, KV denylist.                                                                                                                                                                      |
| `apps/cli`            | Implemented | ~520       | Yes   | `src/index.ts`, `src/local.ts`. `whoami`, `publish`, admin commands. Destructive admin commands require `--yes`.                                                                                                                                                |
| `apps/jobs`           | Scaffolded  | ~65        | No    | `src/index.ts`. Hono + `healthz` only. Empty `runScheduledJobs()`. No queue consumers.                                                                                                                                                                          |
| `apps/web`            | Scaffolded  | ~50        | No    | Hono + `healthz` only. No Auth0, no routes, no UI.                                                                                                                                                                                                              |
| `apps/mcp`            | Scaffolded  | ~85        | No    | Hono + `healthz` only. No OAuth, no MCP transport.                                                                                                                                                                                                              |
| `packages/contracts`  | Implemented | ~810       | Yes   | Zod schemas, branded IDs, route registry. CLI-first MVP surface only.                                                                                                                                                                                           |
| `packages/db`         | Implemented | ~1800      | Yes   | Drizzle schema + SQL migration, repository split into `local-repository.ts`/`postgres/*`, query objects under `queries/*`. MVP runtime queries use Drizzle; admin/cleanup set-based updates keep raw SQL. `db:check` introspection guard runs in `pnpm verify`. |
| `packages/auth`       | Implemented | ~290       | Yes   | API key gen/parse/verify, admin token HMAC, `cachedLookup`, scope registry.                                                                                                                                                                                     |
| `packages/api-client` | Implemented | ~340       | Yes   | Auth resolution, retry, idempotency, cursor pagination.                                                                                                                                                                                                         |
| `packages/storage`    | Implemented | ~60        | Yes   | MIME map, security headers, content-token placeholders.                                                                                                                                                                                                         |
| `packages/commands`   | Implemented | ~150       | Yes   | `runCommand`, `createOperationEvent`, idempotency helpers. Wired into mutation persistence paths in `api` and `upload`.                                                                                                                                         |
| `packages/config`     | Scaffolded  | ~65        | Yes   | Constants and a couple of helpers; no per-app env schema.                                                                                                                                                                                                       |
| `packages/tsconfig`   | Config only | n/a        | n/a   | Shared TS base.                                                                                                                                                                                                                                                 |
| `packages/repo-lint`  | Config only | n/a        | n/a   | Biome rules for docs/scripts.                                                                                                                                                                                                                                   |

## Spec Coverage

Status legend: **Done** = code matches spec; **Partial** = main flow works, gaps remain; **Drift** = code intentionally or accidentally differs; **Future** = explicitly deferred.

| Spec                              | Status  | Gap / next action                                                                                                                                            |
| --------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `docs/specs/README.md`            | Done    | Reading-order index only.                                                                                                                                    |
| `docs/specs/mvp.md`               | Partial | Publish/read flows work; cleanup byte-purge still unverified. Admin `--yes` guards are implemented.                                                          |
| `docs/specs/phases.md`            | Partial | Phase 1 nearly complete (see drift list). Phases 2-6 not started.                                                                                            |
| `docs/specs/features.md`          | Partial | MVP CLI + 3 Workers implemented; future features (multi-revision, OAuth, MCP, dashboard) absent by design.                                                   |
| `docs/specs/api.md`               | Partial | All MVP routes implemented. Error envelope missing `request_id`/`docs` fields. `X-Request-Id` echo needs audit.                                              |
| `docs/specs/data-model.md`        | Partial | Schema + migration match. RLS roles defined in migration but Workers don't `SET LOCAL app.workspace_id`. Operation events are written through `runCommand`.  |
| `docs/specs/content-rendering.md` | Partial | Content Worker handles signed tokens, strict extension MIME, denylist, CSP, SVG strict-CSP. Artifact-level read throttling and broader CSP snapshots remain. |
| `docs/specs/admin.md`             | Partial | Destructive CLI `--yes` guards and admin route idempotency/runCommand wiring are implemented. Operator identity remains interim.                             |
| `docs/specs/acceptance.md`        | Partial | ~80% of acceptance scenarios pass via `smoke:local`. Expired-token cleanup and bytes-after-delete not in smoke.                                              |
| `docs/specs/contracts.md`         | Done    | `packages/contracts` is canonical.                                                                                                                           |
| `docs/specs/local-dev.md`         | Done    | `pnpm smoke:local`, `dev:all`, in-memory harness all working.                                                                                                |
| `docs/specs/product-judgment.md`  | Done    | Philosophy doc; nothing to implement.                                                                                                                        |
| `docs/specs/style-guide.md`       | Future  | Phase 3+. No web UI yet.                                                                                                                                     |
| `docs/specs/jobs.md`              | Future  | Phase 4+. Cleanup currently lives in `api` scheduled handler (intentional MVP shortcut).                                                                     |
| `docs/specs/web.md`               | Future  | Phase 3+. `apps/web` is a Hono stub.                                                                                                                         |

## ADR Coverage

All 67 ADRs in numeric order. Status legend: **Done**, **Partial**, **Drift** (code differs from ADR by intent), **Deferred** (post-MVP per ADR 0066 or phases.md), **Superseded**.

| ADR                                       | Status       | Gap                                                                                                                                                                                        |
| ----------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0001 private artifact storage             | Done         | R2 private buckets in use.                                                                                                                                                                 |
| 0002 Auth0 for workspace auth             | Deferred     | No Auth0 in code; admin token bearer used instead per ADR 0066.                                                                                                                            |
| 0003 restrict artifact JS network         | Done         | CSP `connect-src 'self'` set in content Worker.                                                                                                                                            |
| 0004 audit wrapper for state changes      | Done         | `runCommand` writes the audit event in the same transaction as every mutation.                                                                                                             |
| 0005 Workers + R2 + Postgres + Hyperdrive | Done         | All four bindings present in `wrangler.jsonc`.                                                                                                                                             |
| 0006 small Workers by boundary            | Done         | api/upload/content split. jobs/web/mcp scaffolded for future.                                                                                                                              |
| 0007 Drizzle migrations + preview envs    | Partial      | Migration exists; MVP runtime now goes through Drizzle queries with a `db:check` snapshot guard. Preview Neon branch wired.                                                                |
| 0008 pnpm + Turborepo guardrails          | Done         | Lockfile, workspace config, CI install guardrails.                                                                                                                                         |
| 0009 TypeScript + per-app wrangler        | Done         | Per-app `wrangler.jsonc`.                                                                                                                                                                  |
| 0010 GitHub Actions on Blacksmith         | Done         | CI, PR preview, cleanup, production deploy workflows present.                                                                                                                              |
| 0011 Cloudflare-first observability       | Partial      | Wrangler observability flag on. Logpush -> Axiom click-ops runbook published (`docs/ops/runbook-logpush.md`); console wiring pending Isaac.                                                |
| 0012 preview + production only            | Done         | Wrangler envs match.                                                                                                                                                                       |
| 0013 wrangler-first local dev             | Done         | `pnpm dev:all` and local-mvp-server.mjs.                                                                                                                                                   |
| 0014 single-domain + hardened subdomain   | Partial      | Production routes match. Preview uses `*.preview.agent-paste.sh` — keep or document.                                                                                                       |
| 0015 shared auth primitives               | Done for MVP | `packages/auth` exports shared HMAC + cache.                                                                                                                                               |
| 0016 Hono + OpenAPI                       | Done         | All Workers on Hono. `/openapi.json` is generated from `packages/contracts` via `@asteasolutions/zod-to-openapi` with golden diff in `pnpm verify`.                                        |
| 0017 OpenAPI contract + SDK/CLI           | Partial      | `packages/api-client` exists. OpenAPI schemas now generated from Zod; SDK regeneration pipeline still manual.                                                                              |
| 0018 Drizzle for schema + queries         | Partial      | Schema in Drizzle; MVP workspace/api-key/upload-session/artifact reads + writes use Drizzle query objects (`packages/db/src/queries/*`); admin/cleanup set-based statements still raw SQL. |
| 0019 Cloudflare Queues for jobs           | Deferred     | Phase 4+. Cleanup in `api` scheduled handler.                                                                                                                                              |
| 0020 content caching by revision          | Partial      | Cache headers set; revision-hash cache-key validation not explicit.                                                                                                                        |
| 0021 ID-based R2 object key layout        | Done         | Keys follow `{artifact}/{revision}/{path}`.                                                                                                                                                |
| 0022 idempotent mutations                 | Done         | Every POST/PUT/DELETE in `api` and `upload` honors `Idempotency-Key` via `runCommand`; replay returns cached result, in-flight collision returns 409.                                      |
| 0023 versioned REST APIs                  | Done         | All public routes under `/v1`. Admin under `/admin`.                                                                                                                                       |
| 0024 treat agent data as untrusted        | Partial      | CSP + private R2 + signed URLs in place. 2026-05-21 pass fixed upload MIME trust and content headers. Artifact read throttling remains.                                                    |
| 0025 Biome + Lefthook + Vitest            | Done         | All three configured.                                                                                                                                                                      |
| 0026 Turborepo remote cache               | Done         | Signed cache configured.                                                                                                                                                                   |
| 0027 upload write path                    | Done         | Signed PUT through upload Worker.                                                                                                                                                          |
| 0028 signed URL content tokens            | Done         | HMAC tokens working. Single secret name `CONTENT_SIGNING_SECRET` used by code, bootstrap, and ADR 0058.                                                                                    |
| 0029 MVP CSP + CDN allowlist              | Partial      | CSP set. CDN allowlist value not validated against current ADR allowance list.                                                                                                             |
| 0030 in-origin renderer pages             | Deferred     | MVP serves raw HTML; renderer pages are Phase 3+.                                                                                                                                          |
| 0031 signed content URLs with kid         | Superseded   | Replaced by ADR 0028.                                                                                                                                                                      |
| 0032 jobs Worker trigger model            | Deferred     | Phase 4+.                                                                                                                                                                                  |
| 0033 TanStack Start web app               | Deferred     | Phase 3+.                                                                                                                                                                                  |
| 0034 unified scope model                  | Partial      | Scope registry in `packages/auth`. RLS predicates not active (see ADR 0044).                                                                                                               |
| 0035 runCommand sequencing                | Done         | `runCommand` claims the idempotency record, executes the handler, persists `result_json`, and writes audit events in one transaction.                                                      |
| 0036 error envelope + generic 404         | Partial      | Envelope shape correct; `request_id` and `docs` fields not consistently emitted.                                                                                                           |
| 0037 internal api-client powers CLI       | Done         | `packages/api-client` powers CLI.                                                                                                                                                          |
| 0038 Zod as source of truth               | Partial      | Contracts in Zod; OpenAPI documents now generated from those Zod schemas. Workers still don't validate every request/response body through them.                                           |
| 0039 authenticated rate limits            | Done         | `api` and `upload` call native bindings for API-key traffic; upload mutation routes peek the idempotency record before consuming budget; hosted smoke covers the 429 envelope.             |
| 0040 platform lockdown                    | Partial      | KV denylist writes on delete/cleanup. Operator UI for lockdown deferred to Phase 3+.                                                                                                       |
| 0041 upload size caps                     | Done         | CLI + upload Worker enforce caps.                                                                                                                                                          |
| 0042 strict extension content type        | Done         | `content` ignores upload/R2 MIME metadata, derives from extension allowlist, downloads unknown extensions, and applies SVG strict CSP.                                                     |
| 0043 bearer credential format             | Done         | `ap_pk_{env}_...` format; HMAC + pepper storage.                                                                                                                                           |
| 0044 workspace isolation via RLS          | Partial      | Migration defines RLS roles. Workers do not `SET LOCAL app.workspace_id` per request. Workspace isolation relies on application-layer query scoping.                                       |
| 0045 secret rotation cadence              | Partial      | Bootstrap mints `_V1` keys. Rotation tooling not implemented.                                                                                                                              |
| 0046 operator identity + admin surface    | Drift        | Single bearer admin token (`ADMIN_TOKEN_HASH`) used instead of Cloudflare Access + email allowlist. ADR 0067 accepts this only as interim CLI-first MVP posture before Phase 3.            |
| 0047 Access Link signed URL               | Deferred     | Phase 3+. Public Agent View uses simpler signed token.                                                                                                                                     |
| 0048 transient artifacts by default       | Partial      | TTL defaults + expiry modeled. Byte-purge after expiry not verified end-to-end.                                                                                                            |
| 0049 jobs handler patterns                | Deferred     | Phase 4+.                                                                                                                                                                                  |
| 0050 bundle availability + DLQ            | Deferred     | Phase 4+.                                                                                                                                                                                  |
| 0051 safety scanner lifecycle             | Deferred     | Phase 6.                                                                                                                                                                                   |
| 0052 Agent View from Access Link          | Partial      | Public Agent View works with simpler signed token; Access Link variant deferred.                                                                                                           |
| 0053 manifest shape                       | Deferred     | Phase 4+.                                                                                                                                                                                  |
| 0054 Agent View envelope                  | Done         | API response matches ADR shape.                                                                                                                                                            |
| 0055 signup auto-provisions workspace     | Deferred     | Phase 3. Admin CLI provisions workspaces today.                                                                                                                                            |
| 0056 MVP usage policy defaults            | Done         | Caps match: 10 MB file / 25 MB artifact / 100 files / 30d default TTL.                                                                                                                     |
| 0057 KV denylist namespace + write order  | Partial      | Content Worker reads denylist; API writes on delete/cleanup. Confirm prefix names and write-order match ADR.                                                                               |
| 0058 first-deploy bootstrap               | Partial      | `scripts/bootstrap-secrets.mjs` works. Secret names drift from ADR (see ADR 0028 row).                                                                                                     |
| 0059 web app session sealing              | Deferred     | Phase 3.                                                                                                                                                                                   |
| 0060 CLI auth via Auth0 loopback          | Deferred     | Phase 3. Today the CLI uses an env-var API key.                                                                                                                                            |
| 0061 MCP via Auth0 DCR                    | Deferred     | Phase 5.                                                                                                                                                                                   |
| 0062 two-layer cache for auth             | Done         | `cachedLookup` in `packages/auth` wired into `api` and `upload`.                                                                                                                           |
| 0063 app-layer encryption                 | Deferred     | Phase 6.                                                                                                                                                                                   |
| 0064 native rate-limit bindings           | Done         | Bindings are called in `api` and `upload`; upload routes peek idempotency before rate-limit; hosted smoke asserts the per-actor 429.                                                       |
| 0065 wrangler JSONC                       | Done         | All Workers use `wrangler.jsonc`.                                                                                                                                                          |
| 0066 CLI-first MVP narrowing              | Done         | This is the controlling roadmap ADR.                                                                                                                                                       |
| 0067 interim production security baseline | Done         | Records live-before-app-service controls and follow-ups.                                                                                                                                   |

Superseded ADRs: 0031 (by 0028), part of 0015 (by 0047 for Access Links).

## Phase Status (per `docs/specs/phases.md`)

| Phase                         | Goal                                                      | % done | What is left                                                                                            |
| ----------------------------- | --------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------- |
| Phase 1 — CLI-first MVP       | Real hosted publish loop, expiration, observability floor | ~85%   | Drift items below; PR preview cycle; production smoke under live load; bytes-after-delete verification. |
| Phase 2 — Admin ergonomics    | Admin CLI polish, observability depth                     | ~10%   | Logpush → Axiom; richer event browser; rotation tooling (ADR 0045). CLI `--yes` guards are done.        |
| Phase 3 — Public OAuth + web  | Auth0 tenant, signup, dashboard, Access Links             | 0%     | ADRs 0002, 0033, 0046, 0047, 0052, 0055, 0059, 0060; specs `web.md` and `style-guide.md`.               |
| Phase 4 — Revisions + bundles | Multi-revision artifacts, bundle generation, queues       | 0%     | ADRs 0019, 0032, 0048 (revisions piece), 0049, 0050, 0053; spec `jobs.md`.                              |
| Phase 5 — MCP server          | OAuth-only MCP via Auth0 DCR                              | 0%     | ADR 0061; `apps/mcp` is a stub.                                                                         |
| Phase 6 — Hardening           | App encryption, real safety scanner, optional dashboard   | 0%     | ADRs 0051, 0063.                                                                                        |

## Next Steps Backlog

Ordered. Each item has a verifiable Done. Items 1-4 close Phase 1; items 5-7 prep hosted ops and Phase 2.

When you say "implement the next step," start with item 1 unless we have agreed to skip it.

### 1. Apply Postgres RLS at runtime

- Drives: ADR 0044
- Files: `packages/db/src/**`, `apps/api/src/index.ts`, `apps/upload/src/index.ts`, `packages/db/migrations/*`
- Done: Hyperdrive role is `NOBYPASSRLS`; every request opens a Postgres txn that issues `SET LOCAL app.workspace_id = $1` before any query; a vitest scenario inserts two workspaces and confirms cross-workspace reads return zero rows.

### 2. Exercise PR preview lifecycle on a same-repo PR

- Drives: ADR 0007, ADR 0012, `.github/workflows/pr-preview.yml`
- Files: workflow itself, `scripts/deploy-pr-preview.mjs`, `scripts/cleanup-pr-preview.mjs`
- Done: a same-repo PR (the one carrying items 1-3 above is the natural candidate) creates a Neon branch, deploys preview Workers, runs hosted smoke, posts a comment with URLs, and tears everything down on close. Captured run links recorded in this doc.

### 3. Wire Logpush → Axiom for `api`/`upload`/`content`

- Status: Partial -- runbook ready, click-ops pending Isaac.
- Drives: ADR 0011, `docs/specs/phases.md` Phase 2
- Files: Cloudflare console + `docs/ops/runbook-logpush.md` (no Worker code change required).
- Runbook: [`docs/ops/runbook-logpush.md`](./runbook-logpush.md) -- pre-flight, six Axiom datasets, six Logpush jobs, redaction list, three APL panels, verification curl + APL.
- Done: all six Axiom datasets (preview + production for `api`/`upload`/`content`) receive Worker logs; dashboards show 5xx rate and p95 latency in both envs; secrets/PII redaction confirmed (no API key secret or signed-URL token in logs). When closed, move this entry to Recently Completed.

### 4. Complete bootstrap hosting checklist

- Status: Partial -- checklist ready, click-ops pending Isaac. See [`docs/ops/bootstrap-hosting-checklist.md`](./bootstrap-hosting-checklist.md).
- Drives: ADR 0058, this doc § Bootstrap
- Files: GitHub repo settings, Cloudflare console, Neon console, Bitwarden vault
- Done: DNS for `agent-paste.sh` on Cloudflare nameservers; `NEON_PRODUCTION_BRANCH_ID` and `CLOUDFLARE_ACCOUNT_ID` confirmed (the latter inherited from `zaks-io` org); GitHub `Production` environment has an approval policy; all one-time admin tokens are stored in Bitwarden.

## Recently Completed

### Move MVP runtime queries to Drizzle + introspection check

- Status: Done on 2026-05-22.
- Drives: ADR 0018
- Files: `packages/db/src/index.ts` (now a barrel), `packages/db/src/{policy,types,id,api-keys,validation,transforms,agent-view,local-repository}.ts`, `packages/db/src/postgres/{drizzle,executor,repository,services}.ts`, `packages/db/src/queries/*`, `packages/db/scripts/introspect-check.mjs`, `packages/db/snapshot/schema.sql`, `packages/db/package.json`, `turbo.json`, root `package.json`, `packages/db/src/index.test.ts`.
- Done: MVP workspace/api-key/upload-session/artifact reads and writes go through Drizzle query objects under `packages/db/src/queries/*`; `PostgresRepository` keeps the `runCommand` idempotency wrapper around mutations and binds a Drizzle instance to each `SqlExecutor` via a WeakMap so handlers can recover the typed client; admin/cleanup paths that need set-based updates keep raw `tx.query` calls; `pnpm verify` now runs `db:check`, a turbo task that calls `node packages/db/scripts/introspect-check.mjs` to compare a fresh `drizzle-kit export` against the checked-in `packages/db/snapshot/schema.sql` and exits 1 on drift; forced-drift smoke confirmed the check fails when the snapshot mutates and recovers when reverted.

### Generate OpenAPI from Zod contracts

- Status: Done on 2026-05-21.
- Drives: ADR 0016, ADR 0017, ADR 0038
- Files: `packages/contracts/src/openapi/*`, `packages/contracts/src/zod.ts`, `packages/contracts/openapi/{api,upload,content}.json`, `apps/api/src/index.ts`, `apps/upload/src/index.ts`, `apps/content/src/index.ts`, `scripts/openapi-goldens.mjs`, `turbo.json`, root `package.json`.
- Done: `/openapi.json` on api/upload/content is generated from `packages/contracts` via `@asteasolutions/zod-to-openapi` (peer of `@hono/zod-openapi`, used directly so it works with the plain Hono routes the Workers ship); `pnpm openapi:check` diffs every Worker's served document against a checked-in golden under `packages/contracts/openapi/`; `pnpm verify` runs `openapi:check`; a forced-drift smoke test confirms the check fails when a golden is mutated.

### Complete error envelope (`request_id`, `docs`)

- Status: Done on 2026-05-22 via PR #10.
- Drives: ADR 0036, `docs/specs/contracts.md`
- Files: `apps/api/src/index.ts`, `apps/upload/src/index.ts`, `apps/content/src/index.ts`, `packages/auth/src/request-id.ts`, `apps/*/wrangler.jsonc`
- Done: every Worker response (success or error) carries an `X-Request-Id` header; every error envelope body includes `request_id` matching the header; an optional `docs` URL is attached for codes with a documented remediation when `DOCS_BASE_URL` is set; inbound `X-Request-Id` matching `^[A-Za-z0-9_-]{8,128}$` is echoed, non-matching values are silently replaced with `crypto.randomUUID()`; golden tests in each Worker cover 404/401/409/4xx/429/500 envelope shape and request-id behavior.

### Fix PR preview cleanup workflow

- Status: Done on 2026-05-22.
- Drives: this doc § PR cleanup workflow row
- Files: `.github/workflows/pr-preview-cleanup.yml` (renamed from `cleanup-pr-preview.yml`), `docs/ops/first-deploy.md`
- Root cause: PR #2 added `permissions: administration: write` to the cleanup workflow, but `administration` is not a valid `GITHUB_TOKEN` scope (only fine-grained PATs accept it). GitHub rejected the workflow at evaluation time, so every `pull_request.closed` event for PRs #2--#9 was silently dropped and every push registered a `startup_failure`. Eight stale Neon `preview/pr-N` branches accumulated and tripped the 10-branch free-tier cap, blocking PR #10/#11/#12 deploys with HTTP 422.
- Fix: dropped the invalid permission key and the `deleteAnEnvironment` step that required it (left a one-line note in the cleanup PR comment pointing operators at the UI for the per-PR environment). Renamed the file so GitHub registers a fresh workflow record instead of reusing the wedged one. Added positive-integer validation on the resolved PR number.
- Follow-up (operator-only, agent must not run): purge stale `preview/pr-2` through `preview/pr-9` Neon branches via console or `wrangler`/`neonctl`. The cleanup agent is forbidden from calling `neondatabase/delete-branch-action` autonomously.

### Close obsolete `t3code/*` branches

- Status: Done on 2026-05-21.
- Drives: former backlog item #7 (review/merge `t3code/7bcd4587` and `t3code/5b6355f9`).
- Action: `git fetch origin` plus `gh api repos/:owner/:repo/branches` confirmed neither `t3code/7bcd4587` nor `t3code/5b6355f9` exists on origin; the underlying commits are unreachable in this clone. The only Apex/front-end work that landed from the `t3code/*` family was the marketing worker scaffold merged via PR #1 (`4bde837 feat(apex): add marketing worker at agent-paste.sh`). Nothing left to salvage, so backlog item #7 is closed without a code change beyond removing the stale references from this doc.

### Verify bytes-after-delete and bytes-after-expiry cleanup

- Status: Done on 2026-05-21 via PR #8.
- Drives: ADR 0048, `docs/specs/acceptance.md`
- Files: `apps/api/src/index.ts` (test-only force-expiry endpoint), `scripts/smoke-hosted.mjs`, `scripts/deploy-pr-preview.mjs`
- Done: hosted smoke creates an artifact, deletes it, asserts R2 is empty and view URL returns 404; a second artifact is force-expired through a non-production test endpoint, the scheduled cleanup runs, and the same byte-purge + denylist invariants hold.

### CSP allowlist audit

- Status: Done on 2026-05-21 via PR #6.
- Drives: ADR 0029, ADR 0030, `docs/specs/content-rendering.md`
- Files: `apps/content/test/csp-snapshot.test.ts`, `apps/content/src/index.ts`
- Done: vitest snapshots pin the served CSP header for HTML, CSS, JS, SVG, and PNG; SVG responses use the strict CSP override; the helper used by the snapshots also asserts the constructed artifact key passed to `ARTIFACTS.get`.

### Enforce native rate-limit bindings

- Status: Done on 2026-05-21 via PR #9.
- Drives: ADR 0039, ADR 0064
- Files: `packages/commands/src/index.ts`, `apps/upload/src/index.ts`, `scripts/smoke-hosted.mjs`
- Done: every authenticated mutation calls `env.ACTOR_RATE_LIMIT.limit(...)` and `env.WORKSPACE_BURST_CAP.limit(...)`; over-limit returns 429 with envelope; idempotency replay is checked via the new `peekIdempotentReplay` helper before rate-limit accounting so retries of completed commands skip the budget; hosted smoke (`scripts/smoke-hosted.mjs`, preview/PR targets) hammers an upload mutation until it observes a 429 with the `rate_limited_actor` envelope.

### Consolidate content-signing secret names

- Status: Done on 2026-05-22 via PR #7.
- Drives: ADR 0028, ADR 0058
- Files: `scripts/bootstrap-secrets.mjs`, `docs/ops/project-status.md`
- Kept name: `CONTENT_SIGNING_SECRET`. `CONTENT_GATEWAY_SIGNING_KEY_V1` is removed from the bootstrap script and is no longer minted or bound on any Worker.
- One-time rotation: for any environment that already holds the dropped binding, delete it after the next bootstrap run.

  ```sh
  wrangler secret delete CONTENT_GATEWAY_SIGNING_KEY_V1 --name agent-paste-api-preview
  wrangler secret delete CONTENT_GATEWAY_SIGNING_KEY_V1 --name agent-paste-content-preview
  wrangler secret delete CONTENT_GATEWAY_SIGNING_KEY_V1 --name agent-paste-api-production
  wrangler secret delete CONTENT_GATEWAY_SIGNING_KEY_V1 --name agent-paste-content-production
  ```

### Wire `runCommand` and `createOperationEvent` into mutation routes

- Status: Done on 2026-05-21 by `2dff9d2`.
- Drives: ADR 0022, ADR 0035, `docs/specs/api.md`
- Files: `apps/api/src/index.ts`, `apps/upload/src/index.ts`, `packages/commands/src/index.ts`
- Done: every POST/PUT/DELETE route in `api` and `upload` is wrapped via `runCommand`; idempotency keys are honored from `Idempotency-Key` header; replay of the same idempotency key returns the original result; vitest covers replay for workspace-create, api-key-create, and artifact-delete.

### Add `--yes` guards to destructive admin CLI commands

- Status: Done on 2026-05-21.
- Drives: `docs/specs/admin.md`
- Files: `apps/cli/src/index.ts`
- Done: `agent-paste admin api-key revoke`, `artifacts delete`, and `cleanup run` (non-dry-run) refuse to run without `--yes`; CLI test asserts refusal and a `--yes` happy path.

### Decide on remaining ADR 0046 drift (operator identity)

- Status: Decision completed on 2026-05-21 by ADR 0067. Cloudflare Access/Auth0 operator identity remains future code work before Phase 3.
- Drives: ADR 0046
- Files: ADR 0046 itself, ADR 0067
- Done: ADR 0046 is amended (or a new ADR supersedes it) to either accept the single-bearer admin token as the production model or to commit Cloudflare Access + email allowlist before Phase 3. No code change in this item — just a written decision.

## Bootstrap & Hosted Ops

### Setup for a fresh worktree

```sh
pnpm setup:codex
pnpm verify
pnpm smoke:local
pnpm smoke:preview
```

`pnpm setup:codex` re-runs itself through an installed Node 24 binary when the launching shell is on a different major. If the script is not present yet, fall back to:

```sh
corepack enable
corepack prepare pnpm@10.19.0 --activate
pnpm install --frozen-lockfile --strict-peer-dependencies
pnpm hooks:install
```

### Cloudflare

- [x] Workers Paid plan active.
- [x] Account id: `a461d640900eb3905d7b6619c8c0da91`.
- [x] `wrangler whoami` confirmed for that account.
- [x] OAuth token scopes cover Worker/R2/KV/Hyperdrive deploys.
- [ ] `agent-paste.sh` on Cloudflare nameservers.
- [ ] Production custom domains: `api.`, `upload.`, `usercontent.`.
- [ ] Preview custom domains or intentional `workers.dev` fallback.
- [x] R2 buckets `agent-paste-artifacts-preview` and `agent-paste-artifacts-production`.
- [x] KV namespace ids present in `apps/api/wrangler.jsonc` and `apps/content/wrangler.jsonc`.
- [x] Hyperdrive ids present in `apps/api/wrangler.jsonc` and `apps/upload/wrangler.jsonc`.
- [ ] Rate-limit namespace ids confirmed and supported in this account.

### Neon

- [x] Project: `still-forest-91029005`.
- [ ] Production branch points at production database.
- [x] Shared preview branch in use via Hyperdrive `agent-paste-db-preview-branch`.
- [ ] PR-preview branch creation confirmed end-to-end (item 7 in backlog).
- [ ] Hyperdrive runtime role and migration role separated.
- [ ] Migration URL secrets restricted to migration workflows.

### GitHub

`zaks-io` org provides `CLOUDFLARE_ACCOUNT_ID`, `TURBO_TOKEN`, `TURBO_TEAM=zaks-io`. Check the org before listing org-level secrets as missing.

- [x] `TURBO_TOKEN` (org).
- [x] `TURBO_TEAM=zaks-io` (org).
- [x] `TURBO_REMOTE_CACHE_SIGNATURE_KEY`.
- [ ] `CLOUDFLARE_ACCOUNT_ID` (likely org-inherited; current token cannot list org secrets).
- [x] `CLOUDFLARE_API_TOKEN`.
- [x] `PRODUCTION_DATABASE_URL` in GitHub `Production` environment.
- [x] `NEON_API_KEY`.
- [x] `NEON_PROJECT_ID`.
- [ ] `NEON_PRODUCTION_BRANCH_ID`.
- [x] `CLOUDFLARE_WORKERS_SUBDOMAIN`.
- [x] `AGENT_PASTE_PRODUCTION_ADMIN_TOKEN`.
- [x] GitHub `Production` environment exists (approval policy still needs UI confirmation).
- [ ] `NPM_TOKEN` only when public CLI publish is imminent.

### Worker secrets

`scripts/bootstrap-secrets.mjs` writes the current MVP Worker secrets.

```sh
OPERATOR_EMAILS=isaac@isaacsuttell.com pnpm bootstrap:preview
OPERATOR_EMAILS=isaac@isaacsuttell.com pnpm bootstrap:production
```

| Secret                   | Bound on             | Notes                                   |
| ------------------------ | -------------------- | --------------------------------------- |
| `CONTENT_SIGNING_SECRET` | api, upload, content | Active content-token signing secret.    |
| `UPLOAD_SIGNING_SECRET`  | upload               | Active upload PUT token signing secret. |
| `API_KEY_PEPPER_V1`      | api, upload          | Active API-key/admin-token HMAC pepper. |
| `ADMIN_TOKEN`            | operator only        | Printed once. Capture in Bitwarden.     |
| `ADMIN_TOKEN_HASH`       | api                  | HMAC of `ADMIN_TOKEN`.                  |
| `OPERATOR_EMAILS`        | api                  | Allowlist value for operator context.   |

### Deploy order

1. `pnpm setup:codex`
2. `pnpm verify`
3. `pnpm smoke:local` (use `AGENT_PASTE_LOCAL_*_PORT` overrides if ports collide)
4. Address backlog items 1-4 (or document why they are deferred)
5. `pnpm migrate:preview && pnpm deploy:preview && pnpm smoke:preview`
6. Open a same-repo PR to exercise the preview workflow
7. Production deploy only with explicit Isaac approval: `pnpm migrate:production && pnpm deploy:production && pnpm smoke:production`

## Out of Scope (per ADR 0066)

Do not pull these in without an explicit decision to move past CLI-first MVP:

- Auth0 tenant, OAuth, public login (Phase 3)
- TanStack Start dashboard, Access Link viewer (Phase 3)
- MCP server with OAuth DCR (Phase 5)
- Cloudflare Queues, jobs Worker consumers, bundle generation, real safety scanner (Phases 4-6)
- App-layer byte encryption (Phase 6)
- Multi-revision artifacts and latest-moving links (Phase 4)
- Billing, quotas, plan management (out of MVP roadmap)
- Public TypeScript SDK (gated on stable OpenAPI from backlog #3)
- Standalone CLI binaries beyond npm distribution

## Done Definition for this doc

This file is the source of truth for project status. It is considered fresh when:

- The Snapshot section reflects the actual `HEAD` of `main` and the latest verified smoke results.
- Every ADR added under `docs/adr/` since the last edit has a row in the ADR table.
- Every spec added under `docs/specs/` since the last edit has a row in the Spec table.
- Backlog items completed since the last edit are removed (or moved to a completed list at the bottom if useful) and replaced with the next item in priority.

When in doubt, update this file at the same time as the change that invalidates it.
