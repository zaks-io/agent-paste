# MVP Status And Bootstrap Checklist

Last updated: 2026-05-21.

This is the first file a new agent should read after `AGENTS.md`, `CONTEXT.md`, and `docs/specs/mvp.md`. It answers: what is implemented, what is only scaffolded, which ADR/spec decisions are already reflected in code, and what still blocks preview/production deploy.

## TL;DR

Status: local MVP implementation is verified in this worktree; shared preview infrastructure exists; preview smoke passed after bootstrap provided the preview admin token.

Main blocker: exercise the PR preview workflow on a same-repo PR.

Next command for a fresh Codex worktree:

```sh
pnpm setup:codex
pnpm verify
pnpm smoke:local
pnpm smoke:preview
```

`pnpm setup:codex` now re-runs itself through an installed Node 24 binary when the launching shell is on another Node major. If `pnpm setup:codex` is not available in the checked-out branch yet, run Node 24, copy `.env` from the primary worktree or `.env.example`, then run:

```sh
corepack enable
corepack prepare pnpm@10.19.0 --activate
pnpm install --frozen-lockfile --strict-peer-dependencies
pnpm hooks:install
```

## Current Verification State

- `pnpm setup:codex` completed on 2026-05-21. The first sandboxed install failed with `ENOTFOUND registry.npmjs.org`; rerunning with network approval succeeded.
- `pnpm setup:codex -- --skip-env` was verified on 2026-05-21 from a shell where `node` resolved to v25.9.0; the script re-ran itself through `/Users/isaacsuttell/.nvm/versions/node/v24.15.0/bin/node` and completed.
- `pnpm verify` passed on 2026-05-21 under Node v24.15.0: 45 successful Turbo tasks after adding Hono app scaffolds.
- `pnpm smoke:local` passed on 2026-05-21 after fixing the local harness to pass `API_BASE_URL` and `CONTENT_BASE_URL` into the upload Worker env. A final rerun used `AGENT_PASTE_LOCAL_API_PORT=18787`, `AGENT_PASTE_LOCAL_UPLOAD_PORT=18788`, and `AGENT_PASTE_LOCAL_CONTENT_PORT=18789` because port `8787` was already occupied by a local `workerd` process. The smoke now returns signed content and signed Agent View URLs.
- `pnpm smoke:preview` initially built successfully but did not run hosted assertions because this worktree did not have `AGENT_PASTE_PREVIEW_ADMIN_TOKEN` or `AGENT_PASTE_ADMIN_TOKEN`; after bootstrap, the user reported "Preview smoke passed" on 2026-05-21.
- GitHub shows successful CI and production deploy runs on `main` on 2026-05-21. No PR Preview workflow runs were found, and there are currently no open PRs to exercise that path.

## Implementation Map

| Area | Status | Evidence | Notes |
|---|---|---|---|
| MVP contracts | Implemented | `packages/contracts`, ADR 0066 | Contract package is narrowed to CLI-first MVP routes and schemas. |
| API Worker | Implemented, locally verified | `apps/api/src/index.ts`, `pnpm smoke:local` | Uses Hono routing, serves `/openapi.json`, handles API-key routes, signed public Agent View, admin routes, scheduled cleanup, content URL signing, and denylist writes. |
| Upload Worker | Implemented, locally verified | `apps/upload/src/index.ts`, `pnpm smoke:local` | Uses Hono routing, serves `/openapi.json`, handles upload-session create, signed upload-worker PUT, R2 writes, finalize, and signed Agent View URL minting. |
| Content Worker | Implemented, locally verified | `apps/content/src/index.ts`, `pnpm smoke:local` | Uses Hono routing, serves `/openapi.json`, and serves private R2 bytes through signed content URLs, CSP, strict content-type handling, and KV denylist checks. |
| Public CLI | Implemented, locally verified | `apps/cli/src/index.ts`, `apps/cli/src/local.ts`, `pnpm smoke:local` | Supports `whoami`, `publish`, TTL parsing, local file walking, caps validation, title/entrypoint/render-mode inference. |
| Admin CLI | Implemented, locally verified | `apps/cli/src/index.ts`, `packages/api-client`, `pnpm smoke:local` | Supports workspace/key/artifact/cleanup/events commands. Destructive `--yes` guards are still missing. |
| Database package | Implemented, locally verified | `packages/db/src/index.ts`, `packages/db/migrations/0001_mvp_postgres.sql`, `pnpm verify` | Includes MVP schema, repository methods, HMAC API-key storage, upload sessions, artifacts, files, cleanup, and operation events. |
| Auth helpers | Implemented for MVP | `packages/auth/src/index.ts` | API-key/admin-token HMAC helpers exist. A simple L1 memory + Workers Cache `cachedLookup` helper is wired around Postgres-backed API-key verification in API/upload. |
| Storage helpers | Implemented, locally verified | `packages/storage`, `pnpm verify` | Supports object key/content-token helper behavior used by MVP tests/packages. |
| Command wrapper | Partial/support package | `packages/commands` | Has idempotency/operation-event helpers, but not every Worker route is visibly wrapped through a production transaction boundary yet. |
| Local harness | Implemented, verified | `scripts/local-mvp-server.mjs`, `scripts/smoke-local-mvp.mjs`, `pnpm smoke:local` | Smoke creates workspace/key, publishes fixture, fetches view and Agent View, deletes artifact, checks events. |
| Hosted scripts | Implemented, partially verified | `scripts/bootstrap-secrets.mjs`, `scripts/migrate.mjs`, `scripts/deploy-preview.mjs`, `scripts/smoke-hosted.mjs` | Preview smoke needs `AGENT_PASTE_PREVIEW_ADMIN_TOKEN` locally; production deploy/smoke passed in GitHub Actions on 2026-05-21. |
| PR previews | Implemented workflow, unexercised | `.github/workflows/pr-preview.yml`, cleanup workflow | Creates Neon branch, Hyperdrive, PR Workers, smoke, and cleanup for same-repo PRs. No PR Preview runs found on 2026-05-21. |
| Production deploy | Implemented and passing in GitHub Actions | `.github/workflows/deploy-production.yml`, run `26245768366` | Gated on CI success and GitHub `Production` environment. |
| Jobs/Web/MCP apps | Typed scaffold | `apps/jobs`, `apps/web`, `apps/mcp` | Hono Worker entrypoints, `healthz`, and minimal OpenAPI/discovery endpoints exist. Product behavior remains deferred outside CLI-first MVP. |

## MVP Acceptance Checklist

Use this table to track `docs/specs/mvp.md` directly.

| Acceptance item | Status | Current evidence / next action |
|---|---|---|
| Operator can create a workspace through admin CLI | Implemented, locally verified | Covered by `pnpm smoke:local` on 2026-05-21. |
| Operator can create an API key through admin CLI | Implemented, locally verified | Covered by `pnpm smoke:local` on 2026-05-21. |
| `agent-paste whoami` works with `AGENT_PASTE_API_KEY` | Implemented, locally verified | Covered by `pnpm smoke:local` on 2026-05-21. |
| `agent-paste publish ./site` uploads folder with `index.html` | Implemented, locally verified | Local smoke publishes `examples/local-harness/site`. |
| `agent-paste publish ./demo.html` uploads a single HTML file | Implemented, not explicitly smoke-recorded here | CLI supports single-file publish; add/confirm smoke coverage if this remains untested. |
| Publish returns `artifact_id`, `revision_id`, `view_url`, `agent_view_url`, `expires_at` | Implemented, locally verified | Covered by `pnpm smoke:local` on 2026-05-21. |
| `view_url` opens HTML from content origin | Implemented, locally verified | Covered by `pnpm smoke:local` on 2026-05-21. |
| `agent_view_url` returns JSON with full per-file URLs | Implemented, locally verified | Public Agent View URLs now use a signed token minted by upload finalize and verified by API before DB lookup. |
| Expired artifacts stop resolving and bytes are cleaned up | Partially implemented, unverified | API scheduled/admin cleanup exists. Need verify expiry path and R2 byte removal in local/hosted smoke. |
| Admin CLI can list/inspect/delete artifacts and run cleanup | Implemented, locally verified | Local smoke covers list/get/delete/cleanup dry-run. Add `--yes` guards before production confidence. |
| Operation events omit secrets and signed URLs | Implemented, locally verified | Local smoke checks API key secret and `token=` are not serialized in events. |

## ADR And Spec Coverage

Legend: `Done` means code and docs broadly agree. `Partial` means the MVP path exists but some ADR detail is missing. `Drift` means code intentionally or accidentally differs from the written spec/ADR. `Deferred` means out of the CLI-first MVP.

| ADR/spec | Status | Notes / next action |
|---|---|---|
| ADR 0005 Cloudflare Workers/R2/Postgres/Hyperdrive | Done | Wrangler configs and DB package target this architecture. |
| ADR 0006 small Workers by boundary | Done | API, upload, and content Workers are separated. Jobs is deferred for MVP. |
| ADR 0007 database migrations/previews | Partial | Dynamic Neon PR previews are implemented in workflow. Confirm real GitHub/Neon values and cleanup behavior. |
| ADR 0008 pnpm/Turborepo guardrails | Done | `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `turbo.json`, CI install guardrails exist. |
| ADR 0010 GitHub Actions with Blacksmith | Done | CI, PR preview, cleanup, and production deploy workflows exist. |
| ADR 0011 Cloudflare observability | Partial | Wrangler observability is enabled. Structured operational logs/metrics depth still needs review. |
| ADR 0012 preview/production environments | Done | Preview and production envs exist in Wrangler configs; production workflow uses `Production` environment. |
| ADR 0014 single domain/content subdomain | Partial | Production routes match `api`, `upload`, `usercontent`. Preview routes currently use `api.preview.agent-paste.sh`, `upload.preview...`, `usercontent.preview...`; keep or document this shape. |
| ADR 0015 shared auth primitives | Done for MVP | HMAC helpers plus simple cached API-key lookup are shared from `packages/auth`; app wiring remains explicit. |
| ADR 0016 Hono/OpenAPI | Done for MVP | API, upload, content, jobs, web, and MCP Worker entrypoints use Hono. API/upload/content expose `/openapi.json`. |
| ADR 0017 OpenAPI contract + SDK/CLI | Partial | Zod contracts and internal API client exist. Workers now expose OpenAPI documents, but schemas are still generic placeholders rather than generated directly from Zod contracts. |
| ADR 0018 Drizzle/Postgres | Partial | Drizzle schema/config and SQL migration exist. Runtime queries are mostly direct SQL/repository methods. |
| ADR 0019 Cloudflare Queues | Deferred | Explicitly out of MVP; cleanup lives in API scheduled handler. |
| ADR 0021 R2 object key layout | Done | Object keys follow artifact/revision/file path layout. |
| ADR 0022 idempotent mutations | Partial | Idempotency keys are required on key mutation routes and repository helpers exist; audit route-by-route coverage before production. |
| ADR 0023 versioned REST APIs | Done | Public/control routes are under `/v1` where applicable. Admin is internal `/admin`. |
| ADR 0024 untrusted agent data | Partial | Content Worker isolates untrusted bytes with CSP and private R2. Need review HTML/network behavior against final security bar. |
| ADR 0025 Biome/Lefthook/Vitest | Done | Tooling exists. Needs dependency install before local verification. |
| ADR 0027 upload write path | Done | Upload Worker owns signed PUT URLs and R2 writes. |
| ADR 0028 signed content URLs | Partial | Content URLs are HMAC-signed with `CONTENT_SIGNING_SECRET`; `CONTENT_GATEWAY_SIGNING_KEY_V1` is still generated but not the active env name in code. Clean up naming before production. |
| ADR 0030 CSP execution policy | Partial | Content Worker sets CSP. Validate against final MVP expected allowances. |
| ADR 0032 jobs topology | Deferred | MVP uses API scheduled cleanup per `docs/specs/jobs.md`. |
| ADR 0036 error envelope | Partial | Errors return `{ error: { code, message } }`; request id/docs fields are not consistently present. |
| ADR 0037 internal API client powers CLI | Done | `packages/api-client` powers CLI/admin flows. |
| ADR 0038 Zod source of truth | Partial | Contracts exist, but Workers do not appear to validate all requests/responses directly through Zod at boundaries. |
| ADR 0039 authenticated rate limits | Partial | Wrangler native bindings configured, but Worker code does not visibly call `env.ACTOR_RATE_LIMIT.limit()` / `WORKSPACE_BURST_CAP.limit()` yet. Implement or explicitly defer before hosted launch. |
| ADR 0041 upload size caps | Done | CLI validates caps from usage policy; DB/upload validation also enforces core caps. |
| ADR 0042 strict extension content type | Partial | Content types are extension-derived. Confirm no user-supplied MIME can override served type. |
| ADR 0043 bearer credential format/storage | Done | API keys use `ap_pk_{env}_...` and HMAC secret storage. |
| ADR 0044 workspace isolation/RLS | Partial | Workspace-scoped repository queries exist. Full Postgres RLS enforcement needs review against migration/runtime role setup. |
| ADR 0046 operator identity/admin surface | Drift accepted for MVP | MVP uses single bearer admin token (`ADMIN_TOKEN_HASH`) instead of Cloudflare Access/Auth0. Write a small follow-up ADR or amend ADR 0046 scope. |
| ADR 0048 transient artifacts | Done | TTL defaults/min/max exist and artifact expiry is modeled. Cleanup verification still pending. |
| ADR 0056 MVP usage policy defaults | Done | Usage policy values match MVP caps: 10 MB file, 25 MB artifact, 100 files, 1d-90d TTL, 30d default. |
| ADR 0057 KV denylist | Partial | Content Worker checks KV denylist; API delete/cleanup writes denylist keys. Confirm key names and write order against ADR before production. |
| ADR 0058 first deploy bootstrap | Partial | `scripts/bootstrap-secrets.mjs` exists. Secret names drift from earlier ADR wording; align docs/code before production. |
| ADR 0062 two-layer auth cache | Done for MVP | `packages/auth` exports `cachedLookup`; API/upload use it for Postgres-backed API-key verification with a 60s TTL. |
| ADR 0063 app-layer byte encryption | Deferred | Out of MVP. |
| ADR 0064 native rate-limit bindings | Partial | Bindings exist in Wrangler config; enforcement calls need implementation/review. |
| ADR 0065 wrangler JSONC | Done | Worker configs use `wrangler.jsonc`. |
| ADR 0066 CLI-first MVP contract narrowing | Done | This is the controlling ADR for the narrowed MVP surface. |
| `docs/specs/api.md` signed Agent View token | Done | Upload finalize mints signed public Agent View tokens; API verifies and resolves them to the internal artifact/revision lookup token. |
| `docs/specs/admin.md` destructive `--yes` | Drift | CLI currently exposes destructive admin commands; confirm whether `--yes` guard is implemented or add it. |
| `docs/specs/content-rendering.md` no renderer pages | Done | No Markdown renderer page in MVP. |
| `docs/specs/jobs.md` MVP cleanup in API Worker | Done | API scheduled handler and admin cleanup route exist. |
| `docs/specs/local-dev.md` local smoke | Done | `pnpm smoke:local` passed in this worktree on 2026-05-21. |

## Known Implementation Drift To Resolve

These are the highest-signal issues for the next agent. Do these before treating preview/production as trustworthy.

1. **Rate-limit bindings are configured but may not be enforced.** `ACTOR_RATE_LIMIT` and `WORKSPACE_BURST_CAP` appear in Wrangler configs, but route handlers need visible `limit()` calls.
2. **OpenAPI schemas are placeholders.** `/openapi.json` exists on the Worker surfaces, but schema bodies should be generated from or aligned to `packages/contracts` before external consumers rely on them.
3. **Secret names need consolidation.** Bootstrap generates both `CONTENT_GATEWAY_SIGNING_KEY_V1` and `CONTENT_SIGNING_SECRET`, but the Workers use `CONTENT_SIGNING_SECRET`.
4. **Admin destructive confirmation may be missing.** `docs/specs/admin.md` requires `--yes`; current CLI should be checked and patched if absent.
5. **Plain shell still resolves `node` to v25 in this Codex session.** `pnpm setup:codex` works around this for setup by re-running itself with installed Node 24, but long-running shells may still need `nvm use 24.15.0` or an explicit `PATH` fix before manual commands if engine warnings become failures. This is now a shell hygiene note, not a setup blocker.

## Bootstrap And Hosted Deploy Checklist

### Cloudflare

- [x] Workers Paid plan is assumed/previously marked complete.
- [x] Confirm account id: `a461d640900eb3905d7b6619c8c0da91`.
- [x] Confirm `wrangler whoami` works locally for account `a461d640900eb3905d7b6619c8c0da91`.
- [x] Confirm OAuth/API token has the Worker/R2/KV/Hyperdrive scopes needed for current deploy verification. Wrangler warns about unrelated newer scopes such as `ai-search`, `artifacts`, and `browser`.
- [ ] Confirm `agent-paste.sh` is registered and on Cloudflare nameservers.
- [ ] Confirm production custom domains:
  - `api.agent-paste.sh`
  - `upload.agent-paste.sh`
  - `usercontent.agent-paste.sh`
- [ ] Confirm preview custom domains or intentionally use `workers.dev`:
  - `api.preview.agent-paste.sh`
  - `upload.preview.agent-paste.sh`
  - `usercontent.preview.agent-paste.sh`
- [x] Confirm R2 buckets exist:
  - `agent-paste-artifacts-preview`
  - `agent-paste-artifacts-production`
- [x] Confirm KV namespace IDs in `apps/api/wrangler.jsonc` and `apps/content/wrangler.jsonc` exist.
- [x] Confirm Hyperdrive IDs in `apps/api/wrangler.jsonc` and `apps/upload/wrangler.jsonc` exist.
- [ ] Confirm rate-limit namespace IDs are real and supported in the target Cloudflare account.

### Neon

- [x] Confirm Neon project name/id: `still-forest-91029005` from GitHub repo variables.
- [ ] Confirm production branch points at the production database.
- [x] Confirm shared preview branch exists if using shared preview. Cloudflare Hyperdrive `agent-paste-db-preview-branch` exists and is the configured preview binding.
- [ ] Confirm PR-preview branch creation works from `.github/workflows/pr-preview.yml`. Workflow exists, but no PR Preview runs were found on 2026-05-21.
- [ ] Confirm Hyperdrive runtime role and migration role are separate.
- [ ] Confirm migration URL secrets are available only where needed.

### GitHub

Previous state on 2026-05-20: repo had no repo-level secrets, variables, or environments; org had `CLOUDFLARE_ACCOUNT_ID`, `TURBO_TOKEN`, and `TURBO_TEAM=zaks-io`.

Re-check and fill this before hosted deploy:

- [x] `TURBO_TOKEN` inherited from org.
- [x] `TURBO_TEAM=zaks-io` inherited from org variable.
- [x] `TURBO_REMOTE_CACHE_SIGNATURE_KEY`
- [ ] `CLOUDFLARE_ACCOUNT_ID` (not repo-level; likely inherited from org, but current GitHub token cannot list org secrets/vars)
- [x] `CLOUDFLARE_API_TOKEN`
- [x] `PRODUCTION_DATABASE_URL` in GitHub `Production` environment.
- [x] `NEON_API_KEY`
- [x] `NEON_PROJECT_ID`
- [ ] `NEON_PRODUCTION_BRANCH_ID`
- [x] `CLOUDFLARE_WORKERS_SUBDOMAIN`
- [x] `AGENT_PASTE_PRODUCTION_ADMIN_TOKEN`
- [x] GitHub `Production` environment exists. Approval policy still needs UI confirmation.
- [ ] `NPM_TOKEN` exists only when public CLI publish is imminent.

### Worker Secrets

`scripts/bootstrap-secrets.mjs` generates and writes current MVP Worker secrets.

Preview:

```sh
OPERATOR_EMAILS=isaac@isaacsuttell.com pnpm bootstrap:preview
```

Production:

```sh
OPERATOR_EMAILS=isaac@isaacsuttell.com pnpm bootstrap:production
```

Capture generated one-time values in Bitwarden before closing the terminal.

Current generated/written secret set:

| Secret | Bound on | Notes |
|---|---|---|
| `CONTENT_GATEWAY_SIGNING_KEY_V1` | `api`, `content` | Generated, but code currently uses `CONTENT_SIGNING_SECRET`; clean up naming. |
| `CONTENT_SIGNING_SECRET` | `api`, `upload`, `content` | Active content-token signing secret in code. |
| `UPLOAD_SIGNING_SECRET` | `upload` | Active upload PUT token signing secret. |
| `API_KEY_PEPPER_V1` | `api`, `upload` | Active API-key/admin-token HMAC pepper. |
| `ADMIN_TOKEN` | operator/password manager only | Printed once. |
| `ADMIN_TOKEN_HASH` | `api` | HMAC of `ADMIN_TOKEN`; written to Worker, not printed as operator credential. |
| `OPERATOR_EMAILS` | `api` | Allowlist/reference value for operator context. |

Preview Worker secret names were confirmed in Cloudflare on 2026-05-21 for `api`, `upload`, and `content`. The one-time plaintext preview `ADMIN_TOKEN` was not present in this worktree's `.env`, so hosted preview smoke could not be run locally.

## Deploy/Verification Order

1. **Set up local worktree.**

   ```sh
   pnpm setup:codex
   ```

2. **Run local quality checks.**

   ```sh
   pnpm verify
   ```

3. **Run local MVP smoke.**

   ```sh
   pnpm smoke:local
   ```

   If a local Worker is already listening on the default ports, use alternate ports:

   ```sh
   AGENT_PASTE_LOCAL_API_PORT=18787 AGENT_PASTE_LOCAL_UPLOAD_PORT=18788 AGENT_PASTE_LOCAL_CONTENT_PORT=18789 pnpm smoke:local
   ```

4. **Resolve implementation drift above.** At minimum, decide Agent View signing, rate-limit enforcement, admin `--yes`, and secret-name cleanup.

5. **Run preview migration/deploy/smoke.**

   ```sh
   pnpm migrate:preview
   pnpm deploy:preview
   AGENT_PASTE_PREVIEW_ADMIN_TOKEN=... pnpm smoke:preview
   ```

   As of 2026-05-21, preview Workers, secrets, R2, KV, and Hyperdrive exist. The remaining verification is the actual hosted smoke with the plaintext preview admin token.

6. **Validate PR preview lifecycle.** Open/update a same-repo PR and confirm preview creation, smoke, PR comment, and cleanup-on-close.

7. **Production deploy only after explicit approval.**

   ```sh
   pnpm migrate:production
   pnpm deploy:production
   AGENT_PASTE_PRODUCTION_ADMIN_TOKEN=... pnpm smoke:production
   ```

## Out Of MVP

Do not pull these back into the MVP unless Isaac explicitly asks:

- Auth0 tenant/app/audience setup.
- Public OAuth login.
- Dashboard, admin UI, Access Link viewer.
- MCP server and OAuth DCR.
- Cloudflare Queues/DLQ workers.
- Bundle generation/download.
- Real safety scanner.
- App-layer byte encryption.
- Billing, quotas, and plan management.
- Public TypeScript SDK.
- Standalone binary distribution beyond npm CLI.

## Done Definition

The CLI-first MVP is considered implemented and bootstrap-complete when:

- `pnpm verify` passes under Node 24.
- `pnpm smoke:local` passes.
- Known implementation drift is either fixed or explicitly recorded as accepted MVP scope.
- Preview deploy and `pnpm smoke:preview` pass against hosted Cloudflare + Neon resources.
- Same-repo PR preview creation and cleanup pass.
- Production deploy and `pnpm smoke:production` pass after explicit approval.
- Bootstrap secrets are captured in Bitwarden.
- GitHub secrets/vars and `Production` environment protection are confirmed.
- Cloudflare account, R2, KV, Hyperdrive, rate limits, DNS, and routes are confirmed reachable from a fresh setup.
