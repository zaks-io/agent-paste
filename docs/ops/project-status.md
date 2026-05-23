# Project Status

Last updated: 2026-05-23 (ADR 0057 denylist key drift reconciled for the CLI-first MVP; ADR 0045 rotation groundwork runbook added; web auth swapped from Auth0 to WorkOS AuthKit per ADR 0068; workspace member DB foundation and web Worker secret bootstrap follow-ups completed; Logpush and production deploy-gate work parked for later).

First doc a fresh agent reads after `AGENTS.md`, `CONTEXT.md`, `docs/specs/README.md`, and `docs/adr/README.md`. Answers: what is built, what is scaffolded, where the code diverges from the ADRs/specs, what the next concrete step is.

This doc replaces `mvp-bootstrap-checklist.md`. The MVP work is one slice of a longer roadmap (`docs/specs/phases.md`); this file tracks the whole project, not just Phase 1.

## Snapshot

- `origin/main` is at `22c4b36 Add WorkOS dashboard API foundation (#24)`, atop `361bf4c feat(web): bootstrap apps/web with WorkOS AuthKit + TanStack Start (#23)`. This local `main` is ahead with docs/ignore housekeeping only.
- Latest feature commits on `main`: `361bf4c` (#23 web bootstrap) and `22c4b36` (#24 WorkOS dashboard API). Earlier runtime commits are bug fixes (#20 migration idempotency, #21 Bug A); #22 is status docs.
- Three Workers (`api`, `upload`, `content`) and one CLI (`agent-paste`) are implemented and pass `pnpm smoke:local`, `pnpm smoke:preview`, and `pnpm smoke:production`.
- Every mutation route in `api` and `upload` now flows through `runCommand` with durable idempotency (`packages/db/migrations/0002_idempotency_admin_ops.sql`).
- `apps/web` is a full TanStack Start scaffold (WorkOS AuthKit, twelve routes, `EmptyState` loaders) per ADR 0033/0068. `jobs` and `mcp` remain Hono scaffolds only: `healthz` + `/openapi.json` + no business logic.
- PR preview lifecycle is verified end-to-end on PR #21: Neon branch, per-PR Workers, hosted smoke, PR comment, and cleanup on close all ran.
- GitHub Actions ran successful CI and production-deploy workflows on `main` on 2026-05-22.
- No open `t3code/*` branches remain; all were verified contained in `main` or absent from origin and closed.
- Per `docs/specs/phases.md` and `docs/adr/0066-cli-first-mvp-contract-narrowing.md`, the CLI-first MVP is the active phase; Auth0, web UI, MCP, queues, bundles, encryption are explicitly deferred.
- Coordination note: app-worker work is active in another worktree; this lane should avoid `apps/web`, Auth0, Access Links, and dashboard implementation unless explicitly reassigned.

## Verified State

| Check                   | Result        | Date       | Notes                                                                                                                                                                                                                                                                     |
| ----------------------- | ------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm setup:codex`      | Pass          | 2026-05-21 | Network approval required first run.                                                                                                                                                                                                                                      |
| `pnpm verify`           | Pass          | 2026-05-22 | 61 Turbo tasks on `main` at `6b9a3b5` (post-Bug A).                                                                                                                                                                                                                       |
| `pnpm smoke:local`      | Pass          | 2026-05-21 | Used alt ports 18787-18789 because `workerd` held 8787.                                                                                                                                                                                                                   |
| `pnpm smoke:preview`    | Pass          | 2026-05-22 | PR #21 preview deploy ran on `6b9a3b5`; admin workspace create returns 201 after the drizzle/jsonb fix.                                                                                                                                                                   |
| `pnpm smoke:production` | Pass          | 2026-05-22 | After `6b9a3b5` deploy; full publish + Agent View + content fetch chain green. Run `26291734441`.                                                                                                                                                                         |
| Production deploy       | Pass          | 2026-05-22 | GitHub Actions run `26291734441` (workflow_run auto-trigger off CI success on `6b9a3b5`). Three earlier `workflow_dispatch` retries on `da573a0` failed at validate-migrations until Bug A landed.                                                                        |
| Security hardening pass | Pass          | 2026-05-21 | Content MIME/header hardening, API/upload rate-limit calls, admin CLI `--yes`, ADR 0067. `pnpm verify` pass under Node 25.9.0 with the expected Node 24 engine warning.                                                                                                   |
| PR preview workflow     | Pass          | 2026-05-22 | PR #21 (`agents/bug-a-drizzle-tx`) ran the full lifecycle: deploy-pr-preview built per-PR Workers + Neon branch and ran `pnpm smoke:pr` against them (caught the jsonb regression before merge); pr-preview-cleanup tore Worker resources down on merge. Wave 4 exemplar. |
| PR cleanup workflow     | Re-registered | 2026-05-22 | Renamed to `pr-preview-cleanup.yml` after the prior record's `pull_request.closed` trigger stopped firing for PRs #2--#9.                                                                                                                                                 |

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

- Admin production identity is still the interim hashed bearer-token path. ADR 0067 requires Cloudflare Access/Auth0 operator identity before Phase 3 app/admin rollout.
- `content` still needs unauthenticated artifact-level read throttling.
- Secret rotation has MVP operator groundwork in [`runbook-rotation.md`](./runbook-rotation.md); tested multi-key/multi-pepper automation is still future ADR 0045 work.

## Implementation Map

| Component             | Status                 | Source LOC | Tests | Key files / notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------- | ---------------------- | ---------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api`            | Implemented            | ~950       | Yes   | `src/index.ts`. Hono routing, `/openapi.json`, public Agent View, admin routes, scheduled cleanup, signed content URLs, denylist writes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `apps/upload`         | Implemented            | ~14k       | Yes   | `src/index.ts`. Session create, signed PUT, R2 writes, finalize, signed Agent View URL minting.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `apps/content`        | Implemented            | ~14k       | Yes   | `src/index.ts`. Signed content URL verification, CSP, extension content-type, KV denylist.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `apps/cli`            | Implemented            | ~520       | Yes   | `src/index.ts`, `src/local.ts`. `whoami`, `publish`, admin commands. Destructive admin commands require `--yes`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `apps/jobs`           | Scaffolded             | ~65        | No    | `src/index.ts`. Hono + `healthz` only. Empty `runScheduledJobs()`. No queue consumers.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `apps/web`            | Implemented (scaffold) | ~2.3k      | Yes   | TanStack Start on Workers (`@cloudflare/vite-plugin`, `viteEnvironment: ssr`). Twelve routes per `docs/specs/web.md`. WorkOS AuthKit via `@workos/authkit-tanstack-react-start` + `@workos/authkit-session` (ADR 0068); sealed `__agp_session` cookie owned by AuthKit (HttpOnly, Secure, SameSite=Lax, no `Domain`). Tailwind v4 + style-guide tokens. Service binding to `api` declared; loaders that hit not-yet-built endpoints render `EmptyState` (404/501 fallback). Lint rule blocks session + AuthKit imports from `/al/*` per ADR 0033. Vitest suite (`format`, `Identifier`) green. Remaining work in [`web-app-todo.md`](./web-app-todo.md). |
| `apps/mcp`            | Scaffolded             | ~85        | No    | Hono + `healthz` only. No OAuth, no MCP transport.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `packages/contracts`  | Implemented            | ~810       | Yes   | Zod schemas, branded IDs, route registry. CLI-first MVP surface only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `packages/db`         | Implemented            | ~1800      | Yes   | Drizzle schema + SQL migration, repository split into `local-repository.ts`/`postgres/*`, query objects under `queries/*`. MVP runtime queries use Drizzle; admin/cleanup set-based updates keep raw SQL. `db:check` introspection guard runs in `pnpm verify`.                                                                                                                                                                                                                                                                                                                                                                                          |
| `packages/auth`       | Implemented            | ~290       | Yes   | API key gen/parse/verify, admin token HMAC, `cachedLookup`, scope registry.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `packages/api-client` | Implemented            | ~340       | Yes   | Auth resolution, retry, idempotency, cursor pagination.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `packages/storage`    | Implemented            | ~60        | Yes   | MIME map, security headers, content-token placeholders.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `packages/commands`   | Implemented            | ~150       | Yes   | `runCommand`, `createOperationEvent`, idempotency helpers. Wired into mutation persistence paths in `api` and `upload`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `packages/config`     | Scaffolded             | ~65        | Yes   | Constants and a couple of helpers; no per-app env schema.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `packages/tsconfig`   | Config only            | n/a        | n/a   | Shared TS base.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `packages/repo-lint`  | Config only            | n/a        | n/a   | Biome rules for docs/scripts.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

## Spec Coverage

Status legend: **Done** = code matches spec; **Partial** = main flow works, gaps remain; **Drift** = code intentionally or accidentally differs; **Future** = explicitly deferred.

| Spec                              | Status  | Gap / next action                                                                                                                                                                                                                                              |
| --------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/specs/README.md`            | Done    | Reading-order index only.                                                                                                                                                                                                                                      |
| `docs/specs/mvp.md`               | Partial | Publish/read flows work; delete/expiry byte-purge is verified in local/hosted smoke. Remaining MVP-shaped hardening is artifact read throttling plus interim operator identity follow-ups. Rotation has an MVP runbook; automation remains future work.        |
| `docs/specs/phases.md`            | Partial | Phase 1 is functionally live; remaining active work is hardening/ADR drift cleanup. Phases 2-6 not started except scaffolds and ops runbooks.                                                                                                                  |
| `docs/specs/features.md`          | Partial | MVP CLI + 3 Workers implemented; artifact read cap remains missing. Future features (multi-revision, OAuth, MCP, dashboard) are absent by design.                                                                                                              |
| `docs/specs/api.md`               | Done    | All MVP routes implemented. Error envelopes include `request_id`/optional `docs`; `X-Request-Id` echo/generation is covered by Worker tests.                                                                                                                   |
| `docs/specs/data-model.md`        | Partial | Schema + migration match. Runtime now issues `SET LOCAL app.workspace_id` / `app.platform` per request scope via `rlsExecutor` and policies enforce isolation. Operation events are written through `runCommand`.                                              |
| `docs/specs/content-rendering.md` | Partial | Content Worker handles signed tokens, strict extension MIME, denylist, CSP, SVG strict-CSP, and CSP snapshots. Artifact-level read throttling remains.                                                                                                         |
| `docs/specs/admin.md`             | Partial | Destructive CLI `--yes` guards and admin route idempotency/runCommand wiring are implemented. Operator identity remains interim.                                                                                                                               |
| `docs/specs/acceptance.md`        | Partial | Local/hosted smoke now cover publish/read/delete/expiry byte-purge, Agent View, operation events, and rate-limit 429s. Remaining gaps are artifact read throttling and broader preview/load coverage.                                                          |
| `docs/specs/contracts.md`         | Done    | `packages/contracts` is canonical.                                                                                                                                                                                                                             |
| `docs/specs/local-dev.md`         | Done    | `pnpm smoke:local`, `dev:all`, in-memory harness all working.                                                                                                                                                                                                  |
| `docs/specs/product-judgment.md`  | Done    | Philosophy doc; nothing to implement.                                                                                                                                                                                                                          |
| `docs/specs/style-guide.md`       | Future  | Phase 3+. No web UI yet.                                                                                                                                                                                                                                       |
| `docs/specs/jobs.md`              | Future  | Phase 4+. Cleanup currently lives in `api` scheduled handler (intentional MVP shortcut).                                                                                                                                                                       |
| `docs/specs/web.md`               | Partial | TanStack Start scaffold implements every route from the spec with WorkOS AuthKit + sealed sessions per ADR 0068. Loaders for `/v1/web/*` endpoints render `EmptyState` until those endpoints land in `apps/api` -- see [`web-app-todo.md`](./web-app-todo.md). |

## ADR Coverage

All 68 ADRs in numeric order. Audit on 2026-05-23 confirmed every `docs/adr/0001` through `0068` file has a row here; rows 0029/0030 were corrected to match the ADR filenames. Status legend: **Done**, **Partial**, **Drift** (code differs from ADR by intent), **Deferred** (post-MVP per ADR 0066 or phases.md), **Superseded**.

| ADR                                       | Status       | Gap                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0001 private artifact storage             | Done         | R2 private buckets in use.                                                                                                                                                                                                                                                                                                                                                            |
| 0002 Auth0 for workspace auth             | Superseded   | Superseded for `apps/web` by ADR 0068 (WorkOS AuthKit). CLI (ADR 0060) + MCP (ADR 0061) human-auth provider choices remain open until those surfaces are implemented.                                                                                                                                                                                                                 |
| 0003 restrict artifact JS network         | Done         | CSP `connect-src 'self'` set in content Worker.                                                                                                                                                                                                                                                                                                                                       |
| 0004 audit wrapper for state changes      | Done         | `runCommand` writes the audit event in the same transaction as every mutation.                                                                                                                                                                                                                                                                                                        |
| 0005 Workers + R2 + Postgres + Hyperdrive | Done         | All four bindings present in `wrangler.jsonc`.                                                                                                                                                                                                                                                                                                                                        |
| 0006 small Workers by boundary            | Done         | api/upload/content split. jobs/web/mcp scaffolded for future.                                                                                                                                                                                                                                                                                                                         |
| 0007 Drizzle migrations + preview envs    | Done         | Migration runner, `db:check` snapshot guard, shared preview branch, per-PR Neon branch creation, hosted smoke, and PR cleanup are verified.                                                                                                                                                                                                                                           |
| 0008 pnpm + Turborepo guardrails          | Done         | Lockfile, workspace config, CI install guardrails.                                                                                                                                                                                                                                                                                                                                    |
| 0009 TypeScript + per-app wrangler        | Done         | Per-app `wrangler.jsonc`.                                                                                                                                                                                                                                                                                                                                                             |
| 0010 GitHub Actions on Blacksmith         | Done         | CI, PR preview, cleanup, production deploy workflows present.                                                                                                                                                                                                                                                                                                                         |
| 0011 Cloudflare-first observability       | Partial      | Wrangler observability flag on. Logpush -> Axiom click-ops runbook published (`docs/ops/runbook-logpush.md`); console wiring intentionally parked for Isaac/later.                                                                                                                                                                                                                    |
| 0012 preview + production only            | Done         | Wrangler envs match.                                                                                                                                                                                                                                                                                                                                                                  |
| 0013 wrangler-first local dev             | Done         | `pnpm dev:all` and local-mvp-server.mjs.                                                                                                                                                                                                                                                                                                                                              |
| 0014 single-domain + hardened subdomain   | Partial      | Production routes are live. Preview custom-domain routes are declared in `wrangler.jsonc`, while smoke currently uses the intentional `workers.dev` fallback URLs.                                                                                                                                                                                                                    |
| 0015 shared auth primitives               | Done for MVP | `packages/auth` exports shared HMAC + cache.                                                                                                                                                                                                                                                                                                                                          |
| 0016 Hono + OpenAPI                       | Done         | All Workers on Hono. `/openapi.json` is generated from `packages/contracts` via `@asteasolutions/zod-to-openapi` with golden diff in `pnpm verify`.                                                                                                                                                                                                                                   |
| 0017 OpenAPI contract + SDK/CLI           | Partial      | `packages/api-client` exists. OpenAPI schemas now generated from Zod; SDK regeneration pipeline still manual.                                                                                                                                                                                                                                                                         |
| 0018 Drizzle for schema + queries         | Partial      | Schema in Drizzle; MVP workspace/api-key/upload-session/artifact reads + writes use Drizzle query objects (`packages/db/src/queries/*`); admin/cleanup set-based statements still raw SQL.                                                                                                                                                                                            |
| 0019 Cloudflare Queues for jobs           | Deferred     | Phase 4+. Cleanup in `api` scheduled handler.                                                                                                                                                                                                                                                                                                                                         |
| 0020 content caching by revision          | Partial      | Cache headers set; revision-hash cache-key validation not explicit.                                                                                                                                                                                                                                                                                                                   |
| 0021 ID-based R2 object key layout        | Done         | Keys follow `{artifact}/{revision}/{path}`.                                                                                                                                                                                                                                                                                                                                           |
| 0022 idempotent mutations                 | Done         | Every POST/PUT/DELETE in `api` and `upload` honors `Idempotency-Key` via `runCommand`; replay returns cached result, in-flight collision returns 409.                                                                                                                                                                                                                                 |
| 0023 versioned REST APIs                  | Done         | All public routes under `/v1`. Admin under `/admin`.                                                                                                                                                                                                                                                                                                                                  |
| 0024 treat agent data as untrusted        | Partial      | CSP + private R2 + signed URLs in place. 2026-05-21 pass fixed upload MIME trust and content headers. Artifact read throttling remains.                                                                                                                                                                                                                                               |
| 0025 Biome + Lefthook + Vitest            | Done         | All three configured.                                                                                                                                                                                                                                                                                                                                                                 |
| 0026 Turborepo remote cache               | Done         | Signed cache configured.                                                                                                                                                                                                                                                                                                                                                              |
| 0027 upload write path                    | Done         | Signed PUT through upload Worker.                                                                                                                                                                                                                                                                                                                                                     |
| 0028 signed URL content tokens            | Done         | HMAC tokens working. Single secret name `CONTENT_SIGNING_SECRET` used by code, bootstrap, and ADR 0058.                                                                                                                                                                                                                                                                               |
| 0029 in-origin renderer pages             | Deferred     | MVP serves raw HTML; Markdown/text renderer pages are deferred until demanded by usage.                                                                                                                                                                                                                                                                                               |
| 0030 MVP CSP + CDN allowlist              | Partial      | `content` sends the MVP execution-policy headers and CSP snapshots pin HTML/CSS/JS/SVG/PNG behavior. The future `web` iframe sandbox half is deferred with the app surface.                                                                                                                                                                                                           |
| 0031 signed content URLs with kid         | Superseded   | Replaced by ADR 0028.                                                                                                                                                                                                                                                                                                                                                                 |
| 0032 jobs Worker trigger model            | Deferred     | Phase 4+.                                                                                                                                                                                                                                                                                                                                                                             |
| 0033 TanStack Start web app               | Partial      | Scaffold landed: TanStack Start on Cloudflare Workers via `@cloudflare/vite-plugin`, file routes, sealed `__agp_session` cookie, WorkOS AuthKit via `@workos/authkit-tanstack-react-start` (ADR 0068), service binding to `api`. Loaders for `/v1/web/*` fall back to `EmptyState` until the API endpoints land. Tracked in [`web-app-todo.md`](../ops/web-app-todo.md).              |
| 0034 unified scope model                  | Partial      | Scope registry in `packages/auth`. RLS predicates active runtime-side (see ADR 0044).                                                                                                                                                                                                                                                                                                 |
| 0035 runCommand sequencing                | Done         | `runCommand` claims the idempotency record, executes the handler, persists `result_json`, and writes audit events in one transaction.                                                                                                                                                                                                                                                 |
| 0036 error envelope + generic 404         | Done         | Every Worker response carries `X-Request-Id`; error bodies include matching `request_id` plus optional `docs`; tests cover 404/401/409/4xx/429/500 envelopes.                                                                                                                                                                                                                         |
| 0037 internal api-client powers CLI       | Done         | `packages/api-client` powers CLI.                                                                                                                                                                                                                                                                                                                                                     |
| 0038 Zod as source of truth               | Partial      | Contracts in Zod; OpenAPI documents now generated from those Zod schemas. Workers still don't validate every request/response body through them.                                                                                                                                                                                                                                      |
| 0039 authenticated rate limits            | Done         | `api` and `upload` call native bindings for API-key traffic; upload mutation routes peek the idempotency record before consuming budget; hosted smoke covers the 429 envelope.                                                                                                                                                                                                        |
| 0040 platform lockdown                    | Partial      | KV denylist writes on delete/cleanup. Operator UI for lockdown deferred to Phase 3+.                                                                                                                                                                                                                                                                                                  |
| 0041 upload size caps                     | Done         | CLI + upload Worker enforce caps.                                                                                                                                                                                                                                                                                                                                                     |
| 0042 strict extension content type        | Done         | `content` ignores upload/R2 MIME metadata, derives from extension allowlist, downloads unknown extensions, and applies SVG strict CSP.                                                                                                                                                                                                                                                |
| 0043 bearer credential format             | Done         | `ap_pk_{env}_...` format; HMAC + pepper storage.                                                                                                                                                                                                                                                                                                                                      |
| 0044 workspace isolation via RLS          | Done         | RLS enabled and forced on every tenant table. `PostgresRepository` runs every public method inside a tx that issues `SET LOCAL app.workspace_id` (tenant) or `app.platform = 'on'` (pre-auth, admin sweeps, public Agent View). `DATABASE_RUNTIME_ROLE` migration env strips `BYPASSRLS` from the Hyperdrive role.                                                                    |
| 0045 secret rotation cadence              | Partial      | [`runbook-rotation.md`](./runbook-rotation.md) covers current MVP secret names, WorkOS AuthKit secrets, and deferred Access Link/web-session exclusions. Tested multi-key/multi-pepper automation is not implemented.                                                                                                                                                                 |
| 0046 operator identity + admin surface    | Drift        | Single bearer admin token (`ADMIN_TOKEN_HASH`) used instead of Cloudflare Access + email allowlist. ADR 0067 accepts this only as interim CLI-first MVP posture before Phase 3.                                                                                                                                                                                                       |
| 0047 Access Link signed URL               | Deferred     | Phase 4+. Public Agent View uses simpler signed token.                                                                                                                                                                                                                                                                                                                                |
| 0048 transient artifacts by default       | Partial      | TTL defaults, delete/expiry stop-serving behavior, R2 byte purge, and denylist writes are verified. Pinning and artifact-level unauthenticated read throttling remain absent/deferred.                                                                                                                                                                                                |
| 0049 jobs handler patterns                | Deferred     | Phase 4+.                                                                                                                                                                                                                                                                                                                                                                             |
| 0050 bundle availability + DLQ            | Deferred     | Phase 4+.                                                                                                                                                                                                                                                                                                                                                                             |
| 0051 safety scanner lifecycle             | Deferred     | Phase 6.                                                                                                                                                                                                                                                                                                                                                                              |
| 0052 Agent View from Access Link          | Partial      | Public Agent View works with simpler signed token; Access Link discovery variant is deferred to Phase 4.                                                                                                                                                                                                                                                                              |
| 0053 manifest shape                       | Deferred     | Phase 4+.                                                                                                                                                                                                                                                                                                                                                                             |
| 0054 Agent View envelope                  | Done         | API response matches ADR shape.                                                                                                                                                                                                                                                                                                                                                       |
| 0055 signup auto-provisions workspace     | Deferred     | Phase 3. Admin CLI provisions workspaces today.                                                                                                                                                                                                                                                                                                                                       |
| 0056 MVP usage policy defaults            | Done         | Caps match: 10 MB file / 25 MB artifact / 100 files / 30d default TTL.                                                                                                                                                                                                                                                                                                                |
| 0057 KV denylist namespace + write order  | Done         | MVP code now reads `ad:`/`rd:` denylist keys, reads `wsd:`/`ald:` only when those IDs are present in the verified content token, writes `ad:` on delete/cleanup, and keeps denylist TTL aligned with the current longest signed content-token lifetime.                                                                                                                               |
| 0058 first-deploy bootstrap               | Partial      | `scripts/bootstrap-secrets.mjs` works for the CLI-first MVP. It mints `CONTENT_SIGNING_SECRET`, `UPLOAD_SIGNING_SECRET`, `API_KEY_PEPPER_V1`, `ADMIN_TOKEN_HASH`, `OPERATOR_EMAILS`, and optional WorkOS AuthKit secrets (`WORKOS_API_KEY`, `WORKOS_CLIENT_ID`, `WORKOS_COOKIE_PASSWORD`), and does not mint future `ACCESS_LINK_SIGNING_KEY_V1` / `WEB_SESSION_SEAL_KEY_V1` secrets. |
| 0059 web app session sealing              | Partial      | Sealed `__agp_session` (HttpOnly, Secure, SameSite=Lax, no `Domain`) owned by WorkOS AuthKit (iron-session blob) per ADR 0068; PKCE state handled by AuthKit internally. Current secret name is `WORKOS_COOKIE_PASSWORD`; `WEB_SESSION_SEAL_KEY_V1` is intentionally excluded from MVP rotation/bootstrap.                                                                            |
| 0060 CLI auth via Auth0 loopback          | Deferred     | Phase 3. Today the CLI uses an env-var API key.                                                                                                                                                                                                                                                                                                                                       |
| 0061 MCP via Auth0 DCR                    | Deferred     | Phase 5.                                                                                                                                                                                                                                                                                                                                                                              |
| 0062 two-layer cache for auth             | Done         | `cachedLookup` in `packages/auth` wired into `api` and `upload`.                                                                                                                                                                                                                                                                                                                      |
| 0063 app-layer encryption                 | Deferred     | Phase 6.                                                                                                                                                                                                                                                                                                                                                                              |
| 0064 native rate-limit bindings           | Done         | Bindings are called in `api` and `upload`; upload routes peek idempotency before rate-limit; hosted smoke asserts the per-actor 429.                                                                                                                                                                                                                                                  |
| 0065 wrangler JSONC                       | Done         | All Workers use `wrangler.jsonc`.                                                                                                                                                                                                                                                                                                                                                     |
| 0066 CLI-first MVP narrowing              | Done         | This is the controlling roadmap ADR.                                                                                                                                                                                                                                                                                                                                                  |
| 0067 interim production security baseline | Done         | Records live-before-app-service controls and follow-ups.                                                                                                                                                                                                                                                                                                                              |
| 0068 WorkOS AuthKit for web app auth      | Partial      | `apps/web` swapped to `@workos/authkit-tanstack-react-start`; arctic + bespoke `session.ts` removed. WorkOS project click-ops + secret bootstrap + `apps/api` JWKS verifier still pending -- see [`web-app-todo.md`](./web-app-todo.md).                                                                                                                                              |

Superseded ADRs: 0002 for `apps/web` (by 0068), 0031 (by 0028), part of 0015 (by 0047 for Access Links).

## Phase Status (per `docs/specs/phases.md`)

| Phase                         | Goal                                                      | % done | What is left                                                                                                                                                                                                                                                   |
| ----------------------------- | --------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 1 — CLI-first MVP       | Real hosted publish loop, expiration, observability floor | ~92%   | Artifact read throttling and final hosted smoke after changes.                                                                                                                                                                                                 |
| Phase 2 — Admin ergonomics    | Admin CLI polish, observability depth                     | ~10%   | Richer event browser and rotation tooling (ADR 0045). Logpush → Axiom is parked for later.                                                                                                                                                                     |
| Phase 3 — Public OAuth + web  | WorkOS AuthKit, signup, dashboard, Access Links           | ~15%   | TanStack Start scaffold + style-guide tokens + WorkOS AuthKit wiring shipped per ADR 0068; `workspace_members` schema is in place. Remaining: WorkOS project click-ops, `/v1/web/*` endpoints, real loader wiring. See [`web-app-todo.md`](./web-app-todo.md). |
| Phase 4 — Revisions + bundles | Multi-revision artifacts, bundle generation, queues       | 0%     | ADRs 0019, 0032, 0047, 0048 (revisions piece), 0049, 0050, 0052, 0053; spec `jobs.md`.                                                                                                                                                                         |
| Phase 5 — MCP server          | OAuth-only MCP via Auth0 DCR                              | 0%     | ADR 0061; `apps/mcp` is a stub.                                                                                                                                                                                                                                |
| Phase 6 — Hardening           | App encryption, real safety scanner, optional dashboard   | 0%     | ADRs 0051, 0063.                                                                                                                                                                                                                                               |

## Next Steps Backlog

Ordered for the active non-app-worker lane. Each item has a verifiable Done. Logpush/Axiom and production deploy-gate/vault recordkeeping are parked for Isaac/later and are not the next implementation step.

When you say "implement the next step," start with item 1 unless we have agreed to skip it.

### 1. Add artifact-level read throttling on `content`

- Drives: ADR 0048, `docs/specs/content-rendering.md`, Security Pass follow-up.
- Files: `apps/content/wrangler.jsonc`, `apps/content/src/index.ts`, content tests, hosted smoke if a binding is added.
- Done: unauthenticated reads are limited per artifact with a stable `rate_limited_artifact` envelope and `Retry-After`; idempotent or cached internal checks do not bypass denylist; tests cover allowed and limited reads.

### Parked for later

- Logpush -> Axiom wiring remains documented in [`docs/ops/runbook-logpush.md`](./runbook-logpush.md) but is not active until Isaac is ready for Cloudflare/Axiom click-ops.
- Production deploy-gate policy, wait timers, and Bitwarden recordkeeping remain in [`docs/ops/bootstrap-hosting-checklist.md`](./bootstrap-hosting-checklist.md) but are not active backlog items.

## Recently Completed

### Reconcile ADR 0057 denylist key drift

- Status: Done on 2026-05-23.
- Drives: ADR 0028, ADR 0057, `docs/specs/content-rendering.md`.
- Files: `apps/api/src/index.ts`, `apps/content/src/index.ts`, focused worker tests, `docs/adr/0057-kv-denylist-namespace-keys-and-write-order.md`.
- Done: `content` no longer checks unwritten `content-token:*` keys. It reads `ad:{artifactId}` and `rd:{revisionId}` for every verified token, plus `wsd:{workspaceId}` and `ald:{accessLinkId}` only when the token payload carries those IDs. `api` delete/cleanup denylist writes now use `ad:{artifactId}` with a diagnostic JSON value and a TTL equal to the current maximum signed content-token lifetime, preserving direct MVP URLs that live until artifact expiration.

### Add `workspace_members` DB foundation for WorkOS web auth

- Status: Done on 2026-05-23.
- Drives: ADR 0044, ADR 0055, ADR 0059, ADR 0068.
- Files: `packages/db/migrations/0004_workspace_members.sql`, `packages/db/src/schema.ts`, `packages/db/snapshot/schema.sql`, `packages/db/src/postgres/rls.test.ts`, `docs/ops/web-app-todo.md`.
- Done: `workspace_members` has text member IDs, `workspace_id` FK to `workspaces(id)`, globally unique `workos_user_id`, email, `scopes jsonb not null default '[]'`, created/last-seen timestamps, tenant and platform RLS policies using the migration 0003 drop/create policy pattern, Drizzle schema exposure, and a refreshed schema snapshot. RLS tests cover tenant scoping and global WorkOS-user uniqueness. `pnpm --filter @agent-paste/db db:check`, `pnpm --filter @agent-paste/db check`, and `pnpm verify` are green.

### Extend first-deploy bootstrap for WorkOS web secrets

- Status: Done on 2026-05-23.
- Drives: ADR 0058, ADR 0068, `docs/ops/web-app-todo.md`.
- Files: `scripts/bootstrap-secrets.mjs`, `docs/ops/web-app-todo.md`, `docs/ops/project-status.md`.
- Done: `scripts/bootstrap-secrets.mjs` keeps plain CLI-first bootstrap on the existing `api`/`upload`/`content` secrets, and adds WorkOS setup only when `--with-web` is passed or all WorkOS inputs are supplied. Web setup writes `WORKOS_API_KEY`, `WORKOS_CLIENT_ID`, `WORKOS_COOKIE_PASSWORD`, and `OPERATOR_EMAILS` to `agent-paste-web-{preview,production}`, plus the required WorkOS bindings on `api`. `WORKOS_CLIENT_ID` is written through `wrangler secret put`; matching `wrangler.jsonc` vars remain non-secret deployment metadata/placeholders and are not edited by the script.

### Start ADR 0045 rotation tooling groundwork

- Status: Done on 2026-05-23.
- Drives: ADR 0045, ADR 0058, Phase 2.
- Files: `docs/ops/runbook-rotation.md`, `docs/ops/project-status.md`.
- Done: Added an MVP rotation runbook that matches the current deployed secret names: `CONTENT_SIGNING_SECRET`, `UPLOAD_SIGNING_SECRET`, `API_KEY_PEPPER_V1`, `ADMIN_TOKEN_HASH`, and WorkOS AuthKit's `WORKOS_API_KEY`, `WORKOS_CLIENT_ID`, and `WORKOS_COOKIE_PASSWORD`. The runbook explicitly excludes deferred `ACCESS_LINK_SIGNING_KEY_V1` and removed `WEB_SESSION_SEAL_KEY_V1`, and documents the current single-key invalidation behavior until tested multi-key/multi-pepper primitives land.

### Swap `apps/web` auth from Auth0 to WorkOS AuthKit

- Status: Done on 2026-05-23.
- Drives: ADR 0068 (new), supersedes ADR 0002 for `apps/web`.
- Files: `apps/web/package.json`, `apps/web/src/start.ts` (new), `apps/web/src/server/auth.ts` (rewritten as `getAuth()` shim), `apps/web/src/server/auth-fns.ts` (rewritten), `apps/web/src/server/session.ts` (deleted), `apps/web/src/routes/{auth.callback,login,logout}.tsx`, `apps/web/src/routes/_authed.*.tsx` (five loaders flipped `refreshIfNeeded` → `getCurrentUser`), `apps/web/wrangler.jsonc` (Auth0 vars → WorkOS vars), `apps/web/README.md`, `biome.json` (lint guard list updated), `docs/adr/0068-workos-authkit-for-web-app-auth.md` (new), `docs/adr/0002-auth0-for-workspace-authentication.md` (status: superseded), `docs/adr/README.md`, `docs/ops/web-app-todo.md`, `CONTEXT.md`, `apps/mcp/src/index.ts` (hardcoded Auth0 fallback cleared).
- Done: `apps/web` authenticates through `@workos/authkit-tanstack-react-start@0.8.3` with `authkitMiddleware()` wired via `createStart()` in `apps/web/src/start.ts`. AuthKit reads config from `process.env`, which Cloudflare populates from `vars`/`secret` bindings under `nodejs_compat`. WorkOS owns the iron-session sealed cookie; we keep the name `__agp_session` via `WORKOS_COOKIE_NAME` to preserve the ADR 0059 vocabulary. The callback route delegates to `handleCallbackRoute()`; `signOut()` powers `/logout`; `getSignInUrl()` powers `/login`. A thin `getCurrentUser()` shim projects AuthKit's `{user, accessToken}` onto the existing `CurrentUser` shape so route loaders are unchanged. The Biome `noRestrictedImports` override on `apps/web/src/routes/al.*` adds `@workos/authkit-tanstack-react-start` and `@workos/authkit-session` to the deny list and drops the removed `../server/session` entry. `pnpm --filter @agent-paste/web typecheck` green. WorkOS preview/production project click-ops, secret bootstrap, and the `apps/api` JWKS verifier are tracked in [`web-app-todo.md`](./web-app-todo.md).

### Scaffold `apps/web` as a full TanStack Start app

- Status: Done on 2026-05-22.
- Drives: ADR 0033 (web stack), ADR 0046 (operator gate), ADR 0047 (Access Link viewer), ADR 0059 (session sealing); `docs/specs/web.md`; `docs/specs/style-guide.md`.
- Files: `apps/web/vite.config.ts`, `apps/web/vitest.config.ts`, `apps/web/wrangler.jsonc`, `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/src/router.tsx`, `apps/web/src/client.tsx`, `apps/web/src/server.tsx`, `apps/web/src/routes/**`, `apps/web/src/components/**`, `apps/web/src/server/{env,runtime,session,auth,auth-fns,api-client}.ts`, `apps/web/src/lib/{cn,format,status-mapping}.ts`, `apps/web/src/styles/globals.css`, `apps/web/test/**`, `biome.json`, `docs/ops/web-app-todo.md`, `apps/web/README.md`.
- Done: `apps/web` is no longer a 50-line Hono stub. TanStack Start runs on Cloudflare Workers via `@cloudflare/vite-plugin` (`viteEnvironment: { name: 'ssr' }`); twelve file routes match `docs/specs/web.md` (root, `/`, sign-in, sign-out, callback, `/al/:publicId`, `/healthz`, `_authed` layout + dashboard + artifacts list/detail + keys + audit + settings + admin). Initially shipped with Auth0 Authorization Code + PKCE via `arctic` and `jose`; **superseded** by the WorkOS AuthKit migration logged above — see ADR 0068 for the current auth stack. `__agp_session` cookie sealed (HttpOnly, Secure, SameSite=Lax, no `Domain`). Service binding `API` declared on `wrangler.jsonc` for both `preview` and `production` envs; `apiFetchOrEmpty` treats 404/501 from `api` as "no data yet" and the loaders render `EmptyState` instead of crashing. Style-guide §3 + §4 + §10 tokens live in `globals.css`; Hanken Grotesk + JetBrains Mono self-hosted via `@fontsource*`. Hand-rolled component primitives (`Button`, `Table`, `Card`, `Badge`, `Identifier`, `Skeleton`, `EmptyState`, `Modal`, `Toast`, `ErrorBanner`, `PageHeader`, `Topbar`, `Sidebar`, `WorkspaceSwitcher`, `ThemeToggle`). Theme provider toggles `data-theme` and respects `prefers-color-scheme`. Admin route gated by `is_operator` (ADR 0046); on miss it redirects to `/dashboard`. Access Link viewer iframe is `sandbox="allow-scripts allow-popups"` per §8.3. Biome `noRestrictedImports` override blocks `src/routes/al.*` from importing AuthKit modules or `@tanstack/react-start/server` — verified that adding such an import fails `pnpm lint`. Vitest suite (`format`, `Identifier`) passes. `pnpm verify` green across 62 Turbo tasks. Remaining work (WorkOS click-ops, `/v1/web/*` API endpoints, real loader wiring) is tracked in [`docs/ops/web-app-todo.md`](./web-app-todo.md). Production deploy intentionally **not** executed in this PR — requires WorkOS app + bootstrapped secrets.

### Exercise PR preview lifecycle on a same-repo PR

- Status: Done on 2026-05-22 via PR #21.
- Drives: ADR 0007, ADR 0012, `.github/workflows/pr-preview.yml`, `.github/workflows/pr-preview-cleanup.yml`.
- Files: workflow itself, `scripts/deploy-pr-preview.mjs`, `scripts/cleanup-pr-preview.mjs`, `scripts/smoke-hosted.mjs`.
- Done: PR #21 created a Neon preview branch, deployed per-PR `api`/`upload`/`content`/`apex` Workers, ran `pnpm smoke:pr`, posted preview URLs on the PR, and tore Worker resources down on merge. This caught the jsonb serializer regression before merge, which makes it the current exemplar for the preview lifecycle.

### Fix Bug A: admin workspace create returned 500 in production

- Status: Done on 2026-05-22 via PR #21 (`6b9a3b5`).
- Drives: incident triage; reproduced via `wrangler tail` on `agent-paste-api-production`.
- Files: `packages/db/src/postgres/executor.ts`, `packages/db/src/postgres/drizzle.ts`, `packages/db/src/postgres/executor.test.ts`, `packages/commands/src/index.ts`, `packages/commands/src/index.test.ts`.
- Symptom: every `POST /admin/workspaces` and the `*/15 * * * *` cleanup cron returned 500 with `TypeError: Cannot read properties of undefined (reading 'parsers')`, stack rooted in `drizzle → construct → createPostgresExecutor → sql.begin`. Started after PR #17 (Drizzle MVP-routes work).
- Root cause 1: `createPostgresExecutor` called `drizzle(tx)` _inside_ `sql.begin`. `drizzle-orm/postgres-js`' `construct()` does `client.options.parsers[type] = ...`, but postgres-js' `TransactionSql` does not expose `.options`. Every nested transaction crashed before the handler ran.
- Root cause 2 (surfaced in preview after root cause 1 was fixed): `construct()` also overwrites postgres-js' default jsonb (oid 3802) and json (oid 114) wire serializers with an identity function. Raw `tx.query` callers in `runCommand.executeHandler` that bind JS objects to `$N::jsonb` started throwing `ERR_INVALID_ARG_TYPE` once `construct()` actually ran on the outer client.
- Fix 1: build the outer `DrizzleDb` once, then route nested transactions through `drizzleDb.transaction((txDb) => ...)`. Drizzle's own session hands us a tx-bound `DrizzleDb` whose `session.client` is the postgres-js `TransactionSql` — no re-construction. Applied to both `createPostgresExecutor` and the `DrizzleConnection` wrapper.
- Fix 2: `JSON.stringify` `result_json` and `operation_events.details` in `packages/commands` before binding, so the wire encoder receives a string regardless of what drizzle did to the serializer table.
- Regression coverage: stub `Sql` with `.options.parsers`, stub `TransactionSql` without `.options`, assert `executor.transaction` resolves and routes queries through the tx client; mock `runCommand` executor and assert jsonb params are sent as `JSON.stringify(...)` strings.
- Verification: PR #21 Deploy PR Preview green, production deploy `26291734441` green, `pnpm smoke:production` exited 0.

### Fix Bug B: 0003 RLS migration not idempotent

- Status: Done on 2026-05-22 via PR #20 (`da573a0`).
- Drives: incident triage; deploy-production validate-migrations step.
- Files: `packages/db/migrations/0003_rls_runtime.sql`.
- Symptom: the migration runner has no journal, so every statement must be re-runnable; the original 0003 used bare `create policy ...` which is not idempotent and broke validate-migrations on every re-run.
- Fix: prefixed each `create policy` with `drop policy if exists` and made the `alter role ... nobypassrls` block conditional on `app.runtime_role` being set.

### Apply Postgres RLS at runtime

- Status: Done on 2026-05-22 via PR #18.
- Drives: ADR 0044
- Files: `packages/db/migrations/0003_rls_runtime.sql`, `packages/db/src/postgres/rls.ts`, `packages/db/src/postgres/repository.ts`, `packages/db/src/postgres/rls.test.ts`, `packages/db/scripts/migrate.mjs`, `packages/db/package.json`.
- Done: RLS enabled and `force row level security` on every tenant table (`workspaces`, `api_keys`, `upload_sessions`, `upload_session_files`, `artifacts`, `artifact_files`, `operation_events`, `idempotency_records`); two permissive policies per table cover the tenant scope (`current_setting('app.workspace_id', true)`) and the platform scope (`current_setting('app.platform', true) = 'on'`) used by pre-auth lookups, admin sweeps, and the public Agent View resolve path; the `PostgresRepository` wraps every public method in a transaction whose `SET LOCAL` puts the right scope on first; the migration script accepts a `DATABASE_RUNTIME_ROLE` env to strip `BYPASSRLS` from the Hyperdrive runtime role; the new `rls.test.ts` runs against PGlite (real Postgres, not a mock) using a non-superuser `agent_paste_runtime` role and proves a cross-workspace read returns zero rows, a cross-workspace insert is rejected by the `WITH CHECK`, and an unscoped read returns zero rows (fail-closed).

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
- [x] `agent-paste.sh` on Cloudflare nameservers.
- [x] Production custom domains: apex, `api.`, `upload.`, `usercontent.`.
- [x] Preview custom domains declared; hosted smoke currently uses the intentional `workers.dev` fallback URLs.
- [x] R2 buckets `agent-paste-artifacts-preview` and `agent-paste-artifacts-production`.
- [x] KV namespace ids present in `apps/api/wrangler.jsonc` and `apps/content/wrangler.jsonc`.
- [x] Hyperdrive ids present in `apps/api/wrangler.jsonc` and `apps/upload/wrangler.jsonc`.
- [x] Rate-limit namespace ids present; preview/PR hosted smoke observes the authenticated 429 envelope.

### Neon

- [x] Project: `still-forest-91029005`.
- [x] Production branch points at production database; production deploy and smoke passed on 2026-05-22.
- [x] Shared preview branch in use via Hyperdrive `agent-paste-db-preview-branch`.
- [x] PR-preview branch creation confirmed end-to-end on PR #21.
- [ ] Hyperdrive runtime role and migration role separated.
- [ ] Migration URL secrets restricted to migration workflows.

### GitHub

`zaks-io` org provides `CLOUDFLARE_ACCOUNT_ID`, `TURBO_TOKEN`, `TURBO_TEAM=zaks-io`. Check the org before listing org-level secrets as missing.

- [x] `TURBO_TOKEN` (org).
- [x] `TURBO_TEAM=zaks-io` (org).
- [x] `TURBO_REMOTE_CACHE_SIGNATURE_KEY`.
- [x] `CLOUDFLARE_ACCOUNT_ID` (org-inherited; current token cannot list org secrets, but latest production deploy used it successfully).
- [x] `CLOUDFLARE_API_TOKEN`.
- [x] `PRODUCTION_DATABASE_URL` in GitHub `Production` environment.
- [x] `NEON_API_KEY`.
- [x] `NEON_PROJECT_ID`.
- [ ] `NEON_PRODUCTION_BRANCH_ID` (optional PR-preview safety metadata; not required for production deploy and not active now).
- [x] `CLOUDFLARE_WORKERS_SUBDOMAIN`.
- [x] `AGENT_PASTE_PRODUCTION_ADMIN_TOKEN`.
- [x] GitHub `Production` environment exists.
- [x] GitHub `Production` environment branch policy allows only `main`.
- [ ] GitHub `Production` environment required reviewer / wait timer / admin bypass posture (optional; Isaac will revisit later).
- [ ] `NPM_TOKEN` only when public CLI publish is imminent.

### Worker secrets

`scripts/bootstrap-secrets.mjs` writes the current MVP Worker secrets. Web Worker secrets are opt-in for first deploy: add `--with-web` and provide all WorkOS inputs, or provide the complete `WORKOS_API_KEY`, `WORKOS_CLIENT_ID`, and `WORKOS_COOKIE_PASSWORD` environment set.

```sh
OPERATOR_EMAILS=isaac@isaacsuttell.com pnpm bootstrap:preview
OPERATOR_EMAILS=isaac@isaacsuttell.com pnpm bootstrap:production
OPERATOR_EMAILS=isaac@isaacsuttell.com WORKOS_API_KEY=... WORKOS_CLIENT_ID=... WORKOS_COOKIE_PASSWORD=... pnpm bootstrap:preview -- --with-web
OPERATOR_EMAILS=isaac@isaacsuttell.com WORKOS_API_KEY=... WORKOS_CLIENT_ID=... WORKOS_COOKIE_PASSWORD=... pnpm bootstrap:production -- --with-web
```

| Secret                   | Bound on             | Notes                                                                                          |
| ------------------------ | -------------------- | ---------------------------------------------------------------------------------------------- |
| `CONTENT_SIGNING_SECRET` | api, upload, content | Active content-token signing secret.                                                           |
| `UPLOAD_SIGNING_SECRET`  | upload               | Active upload PUT token signing secret.                                                        |
| `API_KEY_PEPPER_V1`      | api, upload          | Active API-key/admin-token HMAC pepper.                                                        |
| `ADMIN_TOKEN`            | operator only        | Printed once. Capture in Bitwarden.                                                            |
| `ADMIN_TOKEN_HASH`       | api                  | HMAC of `ADMIN_TOKEN`.                                                                         |
| `OPERATOR_EMAILS`        | api, web             | Allowlist value for operator context.                                                          |
| `WORKOS_API_KEY`         | api, web             | Current WorkOS AuthKit API credential.                                                         |
| `WORKOS_CLIENT_ID`       | api, web             | Written as a Worker secret; Wrangler vars stay as non-secret deployment metadata/placeholders. |
| `WORKOS_COOKIE_PASSWORD` | web                  | AuthKit sealed-session password.                                                               |

### Deploy order

1. `pnpm setup:codex`
2. `pnpm verify`
3. `pnpm smoke:local` (use `AGENT_PASTE_LOCAL_*_PORT` overrides if ports collide)
4. Address the active backlog item, or document why it is deferred.
5. For runtime changes, run `pnpm migrate:preview && pnpm deploy:preview && pnpm smoke:preview`.
6. Same-repo PRs now exercise the PR preview workflow automatically.
7. Production deploy only with explicit Isaac approval: `pnpm migrate:production && pnpm deploy:production && pnpm smoke:production`

## Out of Scope (per ADR 0066)

Do not pull these in without an explicit decision to move past CLI-first MVP:

- WorkOS project, OAuth, public login (Phase 3 -- web stack swapped from Auth0 per ADR 0068)
- TanStack Start dashboard, Access Link viewer (Phase 3)
- MCP server with OAuth DCR (Phase 5)
- Cloudflare Queues, jobs Worker consumers, bundle generation, real safety scanner (Phases 4-6)
- App-layer byte encryption (Phase 6)
- Multi-revision artifacts and latest-moving links (Phase 4)
- Billing, quotas, plan management (out of MVP roadmap)
- Public TypeScript SDK (gated on stable OpenAPI and product demand)
- Standalone CLI binaries beyond npm distribution

## Done Definition for this doc

This file is the source of truth for project status. It is considered fresh when:

- The Snapshot section reflects the actual `HEAD` of `main` and the latest verified smoke results.
- Every ADR added under `docs/adr/` since the last edit has a row in the ADR table.
- Every spec added under `docs/specs/` since the last edit has a row in the Spec table.
- Backlog items completed since the last edit are removed (or moved to a completed list at the bottom if useful) and replaced with the next item in priority.

When in doubt, update this file at the same time as the change that invalidates it.
