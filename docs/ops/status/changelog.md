# Changelog

Newest first. This is an operator-facing changelog for implemented project work;
use `git log` for commit-level detail.

## 2026-05-27

### CLI credential hardening (AP-77)

- Added native OS keyring storage for CLI login credentials with a warned `0600`
  file fallback.
- Added API key `expires_at`, 90-day expiry for CLI-minted keys, and current-key
  self-revoke for `agent-paste logout`.
- Updated dashboard key state display to distinguish Active, Expired, and
  Revoked keys.

### Pinning and revision retention (AP-24)

- Added `artifacts.pinned_at` and dashboard `POST /v1/web/artifacts/{id}/pin|unpin`
  with a 50-artifact workspace cap; pinned rows are exempt from auto-deletion.
- Added `workspaces.revision_retention_days`; jobs retention cron marks older
  non-current published revisions `retained`, writes `rd:` denylist keys, and
  enqueues revision-scoped byte purge.
- Migration `0013_pinning_and_revision_retention.sql`.

### Jobs lifecycle byte purge ownership (AP-22)

- Moved auto-deletion expiry, denylist writes, and byte-purge enqueue from the
  API Worker scheduled cleanup path into `apps/jobs` cron discovery.
- Added purge recovery for deleted/expired artifacts missing
  `bytes_purge_enqueued_at`, plus jobs smoke harness routes for cleanup and
  purge recovery.
- Removed the API cron trigger and `POST /__test__/run-cleanup`; local/hosted
  smokes now call the jobs worker.

## 2026-05-26

### Neon database credential boundaries (AP-18)

- Added migration `0010_db_roles.sql` creating `app_role` (`NOBYPASSRLS`) and
  `platform_admin` (`BYPASSRLS`) with grants.
- Migration workflows use `DATABASE_URL_MIGRATIONS_*`; PR previews resolve
  separate Neon URLs for migrate (`platform_admin`) and Hyperdrive (`app_role`).
- Documented operator cutover in `docs/ops/runbook-neon-database-roles.md`.

### Operator event and audit browsing (AP-16)

- Added `GET /v1/web/admin/events` for WorkOS operators with pagination and
  filters (`focus`, workspace, actor type, action, target type, request id).
- Extended the `/admin` dashboard with a cross-workspace platform events table.
- Workspace member audit at `/v1/web/audit` remains tenant-scoped.
- Restored the branch coverage gate after merge with focused operator panel and
  query adapter tests; `pnpm test:coverage` reports 80.7% branch coverage.

### AP-13: retire legacy ADMIN_TOKEN admin path

- Removed `/admin/*` contract routes, API handlers, CLI `admin` verbs, and
  `ADMIN_TOKEN`/`ADMIN_TOKEN_HASH` bootstrap secrets.
- Added `SMOKE_HARNESS_SECRET` and non-production `__test__/*` smoke helpers;
  production hosted smoke uses `AGENT_PASTE_PRODUCTION_SMOKE_API_KEY`.

### Production operator access smoke

- Verified Cloudflare Access service-token auth against production
  `/v1/web/admin/lockdowns`.
- Switched human operator eligibility to the WorkOS `admin` role slug and
  verified browser access to `https://app.agent-paste.sh/admin`.
- AP-12 migration plan executed; legacy admin path fully retired.

### MCP auth decision

- Re-decided MCP OAuth on WorkOS AuthKit/Connect before implementation.
- ADR 0061 now uses CIMD as the primary MCP client self-identification path and
  keeps DCR enabled for compatibility with older MCP clients.

### npm package namespace

- Created the npm org scope `@zaks-io` and reserved the public CLI package name
  `@zaks-io/agent-paste` with placeholder version `0.0.0`.
- The package name is scoped, but the installed command remains `agent-paste`.

## 2026-05-25

### Open-core billing decisions

- Added ADR 0073 for `free`/`pro` Plan tiers behind a billing flag that is off by
  default.
- Added ADR 0074 for Stripe as a sync layer over local entitlement state.
- No billing code is implemented yet; `packages/billing`, `workspaces.plan`,
  `workspace_billing`, Stripe routes, webhooks, Portal, and jobs reconciliation
  remain future work.

### Repo/docs guardrails and coverage

- Recent `main` includes docs and monorepo guardrail work through
  `b7927d5 docs: competitor analysis and open-core billing ADRs (#67)`.
- `pnpm verify` passes on 2026-05-25 with 72 Turbo tasks.

### Operator lockdown UI

- Added the web `/admin` operator screen over the existing lockdown set, lift,
  and list API endpoints.
- Operator lockdown mutations run through server functions with WorkOS bearer
  forwarding, contract validation, idempotency keys, and dashboard toasts.

## 2026-05-24

### Web deploy, dashboard auth, and preview hardening

- Stable preview and production web Workers are deployed.
- Hosted web smoke asserts `/healthz` and `/api/auth/sign-in` redirect behavior.
- Per-PR web deploy is wired into preview workflow, fail-soft unless the WorkOS
  preview API key secret is present.
- Fixed live dashboard auth issuer mismatch after structured WorkOS rejection
  logging identified the real issuer.
- Fixed unauthenticated `_authed` routes returning 500 by dropping the query
  string from thrown redirects.

### CLI login

- Implemented `agent-paste login` and `agent-paste logout` with WorkOS loopback
  PKCE.
- Login mints a scoped API key via `/v1/web/keys`, stores it locally, discards
  the WorkOS token, and respects precedence `AGENT_PASTE_API_KEY` over stored
  credentials.
- Verified end-to-end against preview: login -> whoami -> logout.

### Dashboard wiring

- Dashboard loaders call live `/v1/web/*` endpoints.
- Key create/revoke and settings save run through server functions with
  idempotency keys.
- First-run key card and error toasts are implemented.
- Access Links remain a placeholder.

### Operator lockdown APIs

- Added operator-only set/lift/list lockdown endpoints.
- Operator auth accepts WorkOS operator sessions or the rotation-agent Access
  service-token identity and rejects API keys.
- Lockdowns persist in `platform_lockdowns` and write/clear KV denylist keys.

### Settings and retention

- Added `GET`/`PATCH /v1/web/settings` for workspace name and
  `auto_deletion_days`.
- Added `workspaces.auto_deletion_days` with bounds 1-90 and audit events for
  settings updates.

### Route contracts and token codec

- Implemented `packages/worker-runtime` and mounted `api`, `upload`, and
  `content` route contracts through the registrar/request guard.
- Implemented `packages/tokens` as the shared signed-token codec for content,
  Agent View, and upload URLs.

### Hosted content read throttling

- Hosted PR-preview smoke asserts artifact-level unauthenticated read throttling
  returns 429 with the expected envelope and `Retry-After`.

## 2026-05-23

- Implemented dashboard read API tranche: workspace, artifact list/detail,
  API-key list.
- Added dashboard API-key create/revoke and cursor-paginated audit reads.
- Added `workspace_members` foundation and WorkOS web callback provisioning.
- Extended secret bootstrap for WorkOS web secrets.
- Added MVP rotation runbook.
- Swapped `apps/web` from the original Auth0 scaffold to WorkOS AuthKit.
- Unified repository adapters behind a backend-agnostic `RepositoryCore`.
- Reconciled ADR 0057 denylist key drift.
- Added artifact-level read throttling in `content`.

## 2026-05-22

- Scaffolded `apps/web` as a full TanStack Start app.
- Exercised PR preview lifecycle on PR #21: Neon branch, per-PR Workers,
  hosted smoke, PR comment, and cleanup.
- Fixed production admin workspace create / scheduled cleanup failures caused by
  Drizzle/postgres-js transaction and jsonb serializer behavior.
- Made RLS migration 0003 idempotent.
- Applied Postgres RLS at runtime with tenant/platform scopes.
- Moved MVP runtime queries to Drizzle query objects and added `db:check`.
- Generated OpenAPI from Zod contracts and golden-checked it in `pnpm verify`.
- Completed the cross-Worker error envelope with request IDs.
- Fixed PR preview cleanup workflow registration.

## 2026-05-21

- Verified bytes-after-delete and bytes-after-expiry cleanup in hosted smoke.
- Audited CSP allowlist behavior with snapshots.
- Enforced native rate-limit bindings for authenticated routes.
- Consolidated content signing secret names.
- Wired `runCommand` and operation events into mutation routes.
- Added `--yes` guards to destructive admin CLI commands.
- Closed obsolete `t3code/*` branch references.
