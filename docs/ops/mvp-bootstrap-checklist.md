# MVP Status And Bootstrap Checklist

Last updated: 2026-05-21.

This is the first file a new agent should read after `AGENTS.md`, `CONTEXT.md`, and `docs/specs/mvp.md`. It answers: what is implemented, what is only scaffolded, which ADR/spec decisions are already reflected in code, and what still blocks preview/production deploy.

## TL;DR

Status: local MVP implementation is mostly in place, but not verified in this worktree yet.

Main blocker: install the Node 24 toolchain and dependencies, then run verification.

Next command for a fresh Codex worktree:

```sh
pnpm setup:codex
pnpm verify
pnpm smoke:local
```

If `pnpm setup:codex` is not available in the checked-out branch yet, run Node 24, copy `.env` from the primary worktree or `.env.example`, then run:

```sh
corepack enable
corepack prepare pnpm@10.19.0 --activate
pnpm install --frozen-lockfile --strict-peer-dependencies
pnpm hooks:install
```

## Current Verification State

- `pnpm verify` was attempted on 2026-05-21.
- It did not reach code validation because this worktree had no `node_modules`, the active Node was `v25.9.0`, and the repo requires Node `>=24 <25`.
- Local tools such as `biome`, `tsc`, and `vitest` were unavailable because dependencies had not been installed.
- No successful `pnpm verify`, `pnpm smoke:local`, preview smoke, or production smoke has been recorded in this document yet.

## Implementation Map

| Area | Status | Evidence | Notes |
|---|---|---|---|
| MVP contracts | Implemented | `packages/contracts`, ADR 0066 | Contract package is narrowed to CLI-first MVP routes and schemas. |
| API Worker | Implemented, unverified in this worktree | `apps/api/src/index.ts` | Handles API-key routes, public Agent View, admin routes, scheduled cleanup, content URL signing, and denylist writes. |
| Upload Worker | Implemented, unverified in this worktree | `apps/upload/src/index.ts` | Handles upload-session create, signed upload-worker PUT, R2 writes, and finalize. |
| Content Worker | Implemented, unverified in this worktree | `apps/content/src/index.ts` | Serves private R2 bytes through signed content URLs, CSP, strict content-type handling, and KV denylist checks. |
| Public CLI | Implemented, unverified in this worktree | `apps/cli/src/index.ts`, `apps/cli/src/local.ts` | Supports `whoami`, `publish`, TTL parsing, local file walking, caps validation, title/entrypoint/render-mode inference. |
| Admin CLI | Implemented, unverified in this worktree | `apps/cli/src/index.ts`, `packages/api-client` | Supports workspace/key/artifact/cleanup/events commands. |
| Database package | Implemented, unverified in this worktree | `packages/db/src/index.ts`, `packages/db/migrations/0001_mvp_postgres.sql` | Includes MVP schema, repository methods, HMAC API-key storage, upload sessions, artifacts, files, cleanup, and operation events. |
| Auth helpers | Partially implemented | `packages/auth/src/index.ts` | API-key/admin-token HMAC helpers exist. ADR 0062 two-layer `cachedLookup` helper is not implemented. |
| Storage helpers | Implemented, unverified in this worktree | `packages/storage` | Supports object key/content-token helper behavior used by MVP tests/packages. |
| Command wrapper | Partial/support package | `packages/commands` | Has idempotency/operation-event helpers, but not every Worker route is visibly wrapped through a production transaction boundary yet. |
| Local harness | Implemented, unverified in this worktree | `scripts/local-mvp-server.mjs`, `scripts/smoke-local-mvp.mjs` | Smoke creates workspace/key, publishes fixture, fetches view and Agent View, deletes artifact, checks events. |
| Hosted scripts | Implemented, not yet proven here | `scripts/bootstrap-secrets.mjs`, `scripts/migrate.mjs`, `scripts/deploy-preview.mjs`, `scripts/smoke-hosted.mjs` | Need real Cloudflare/Neon/GitHub secrets to exercise. |
| PR previews | Implemented workflow, not yet proven here | `.github/workflows/pr-preview.yml`, cleanup workflow | Creates Neon branch, Hyperdrive, PR Workers, smoke, and cleanup for same-repo PRs. |
| Production deploy | Implemented workflow, not yet proven here | `.github/workflows/deploy-production.yml` | Gated on CI success and GitHub `Production` environment. |
| Jobs/Web/MCP apps | Deferred/scaffold only | `apps/jobs`, `apps/web`, `apps/mcp` | Out of CLI-first MVP. |

## MVP Acceptance Checklist

Use this table to track `docs/specs/mvp.md` directly.

| Acceptance item | Status | Current evidence / next action |
|---|---|---|
| Operator can create a workspace through admin CLI | Implemented, unverified | `agent-paste admin workspace create`; covered by local smoke once run. |
| Operator can create an API key through admin CLI | Implemented, unverified | `agent-paste admin key create`; covered by local smoke once run. |
| `agent-paste whoami` works with `AGENT_PASTE_API_KEY` | Implemented, unverified | CLI + API client route exist; covered by local smoke once run. |
| `agent-paste publish ./site` uploads folder with `index.html` | Implemented, unverified | Local smoke publishes `examples/local-harness/site`. |
| `agent-paste publish ./demo.html` uploads a single HTML file | Implemented, not explicitly smoke-recorded here | CLI supports single-file publish; add/confirm smoke coverage if this remains untested. |
| Publish returns `artifact_id`, `revision_id`, `view_url`, `agent_view_url`, `expires_at` | Implemented, unverified | `packages/db` publish result shape and smoke assertions cover it. |
| `view_url` opens HTML from content origin | Implemented, unverified | Content Worker and smoke assertions cover it. |
| `agent_view_url` returns JSON with full per-file URLs | Implemented with drift | JSON exists; current public token is `artifact_id.revision_id`, not a separately signed Agent View token. Decide before production whether this is acceptable. |
| Expired artifacts stop resolving and bytes are cleaned up | Partially implemented, unverified | API scheduled/admin cleanup exists. Need verify expiry path and R2 byte removal in local/hosted smoke. |
| Admin CLI can list/inspect/delete artifacts and run cleanup | Implemented, unverified | CLI routes exist; local smoke covers list/get/delete/cleanup dry-run. |
| Operation events omit secrets and signed URLs | Implemented, unverified | Local smoke checks API key secret and `token=` are not serialized in events. |

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
| ADR 0015 shared auth primitives | Partial | HMAC helpers exist. Auth cache from ADR 0062 is missing. |
| ADR 0016 Hono/OpenAPI | Drift | Current Workers are hand-rolled route handlers, not Hono/OpenAPI. Decide whether MVP accepts this or needs a follow-up refactor. |
| ADR 0017 OpenAPI contract + SDK/CLI | Partial | Zod contracts and internal API client exist. Public OpenAPI generation is not evident. |
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
| ADR 0062 two-layer auth cache | Not implemented | `packages/auth` does not export `cachedLookup`; no L1/L2 cache observed in hot paths. |
| ADR 0063 app-layer byte encryption | Deferred | Out of MVP. |
| ADR 0064 native rate-limit bindings | Partial | Bindings exist in Wrangler config; enforcement calls need implementation/review. |
| ADR 0065 wrangler JSONC | Done | Worker configs use `wrangler.jsonc`. |
| ADR 0066 CLI-first MVP contract narrowing | Done | This is the controlling ADR for the narrowed MVP surface. |
| `docs/specs/api.md` signed Agent View token | Drift | Code uses `artifact_id.revision_id` token for public Agent View. Decide whether to sign Agent View tokens before production. |
| `docs/specs/admin.md` destructive `--yes` | Drift | CLI currently exposes destructive admin commands; confirm whether `--yes` guard is implemented or add it. |
| `docs/specs/content-rendering.md` no renderer pages | Done | No Markdown renderer page in MVP. |
| `docs/specs/jobs.md` MVP cleanup in API Worker | Done | API scheduled handler and admin cleanup route exist. |
| `docs/specs/local-dev.md` local smoke | Partial | Local smoke script exists; has not passed in this worktree yet. |

## Known Implementation Drift To Resolve

These are the highest-signal issues for the next agent. Do these before treating preview/production as trustworthy.

1. **Agent View token is not separately signed.** Specs describe a signed Agent View token; code currently uses `/v1/public/agent-view/{artifact_id}.{revision_id}`. Either implement signed tokens or update the spec/ADR to accept opaque-enough revision addressing for MVP.
2. **Rate-limit bindings are configured but may not be enforced.** `ACTOR_RATE_LIMIT` and `WORKSPACE_BURST_CAP` appear in Wrangler configs, but route handlers need visible `limit()` calls.
3. **ADR 0062 auth cache is missing.** Decide whether this is a pre-production requirement or a post-MVP performance follow-up.
4. **Hono/OpenAPI ADR is not followed by current Workers.** Decide whether hand-rolled routing is acceptable for MVP.
5. **Secret names need consolidation.** Bootstrap generates both `CONTENT_GATEWAY_SIGNING_KEY_V1` and `CONTENT_SIGNING_SECRET`, but the Workers use `CONTENT_SIGNING_SECRET`.
6. **Admin destructive confirmation may be missing.** `docs/specs/admin.md` requires `--yes`; current CLI should be checked and patched if absent.
7. **Verification has not run cleanly in this worktree.** Toolchain setup comes first.

## Bootstrap And Hosted Deploy Checklist

### Cloudflare

- [x] Workers Paid plan is assumed/previously marked complete.
- [ ] Confirm account id: `__________`
- [ ] Confirm `wrangler whoami` works locally for account `a461d640900eb3905d7b6619c8c0da91` or update this doc with the real account.
- [ ] Confirm OAuth/API token has Workers, Routes, KV, R2, Hyperdrive, Account Settings, Zone Settings, and DNS edit scopes.
- [ ] Confirm `agent-paste.sh` is registered and on Cloudflare nameservers.
- [ ] Confirm production custom domains:
  - `api.agent-paste.sh`
  - `upload.agent-paste.sh`
  - `usercontent.agent-paste.sh`
- [ ] Confirm preview custom domains or intentionally use `workers.dev`:
  - `api.preview.agent-paste.sh`
  - `upload.preview.agent-paste.sh`
  - `usercontent.preview.agent-paste.sh`
- [ ] Confirm R2 buckets exist:
  - `agent-paste-artifacts-preview`
  - `agent-paste-artifacts-production`
- [ ] Confirm KV namespace IDs in `apps/api/wrangler.jsonc` and `apps/content/wrangler.jsonc` exist.
- [ ] Confirm Hyperdrive IDs in `apps/api/wrangler.jsonc` and `apps/upload/wrangler.jsonc` exist.
- [ ] Confirm rate-limit namespace IDs are real and supported in the target Cloudflare account.

### Neon

- [ ] Confirm Neon project name/id: `__________`
- [ ] Confirm production branch points at the production database.
- [ ] Confirm shared preview branch exists if using shared preview.
- [ ] Confirm PR-preview branch creation works from `.github/workflows/pr-preview.yml`.
- [ ] Confirm Hyperdrive runtime role and migration role are separate.
- [ ] Confirm migration URL secrets are available only where needed.

### GitHub

Previous state on 2026-05-20: repo had no repo-level secrets, variables, or environments; org had `CLOUDFLARE_ACCOUNT_ID`, `TURBO_TOKEN`, and `TURBO_TEAM=zaks-io`.

Re-check and fill this before hosted deploy:

- [x] `TURBO_TOKEN` inherited from org.
- [x] `TURBO_TEAM=zaks-io` inherited from org variable.
- [ ] `TURBO_REMOTE_CACHE_SIGNATURE_KEY`
- [ ] `CLOUDFLARE_ACCOUNT_ID`
- [ ] `CLOUDFLARE_API_TOKEN`
- [ ] `PRODUCTION_DATABASE_URL` in GitHub `Production` environment.
- [ ] `NEON_API_KEY`
- [ ] `NEON_PROJECT_ID`
- [ ] `NEON_PRODUCTION_BRANCH_ID`
- [ ] `CLOUDFLARE_WORKERS_SUBDOMAIN`
- [ ] `AGENT_PASTE_PRODUCTION_ADMIN_TOKEN`
- [ ] GitHub `Production` environment exists and requires Isaac approval.
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

4. **Resolve implementation drift above.** At minimum, decide Agent View signing, rate-limit enforcement, admin `--yes`, and secret-name cleanup.

5. **Run preview migration/deploy/smoke.**

   ```sh
   pnpm migrate:preview
   pnpm deploy:preview
   AGENT_PASTE_PREVIEW_ADMIN_TOKEN=... pnpm smoke:preview
   ```

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
