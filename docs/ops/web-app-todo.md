# Web app — remaining work

Source of truth for what's left after the TanStack Start scaffold landed in `apps/web`. Owner: Isaac. Snapshot date: 2026-05-23.

Scope clarification: this file tracks only the work that closes Phase 3 (`docs/specs/phases.md`). Phase 1/2 work continues to be tracked in `docs/ops/project-status.md`.

## Operator click-ops (blocks first real login)

- [ ] Provision the WorkOS project in the existing WorkOS organization (or create one).
  - Configure AuthKit; enable email/password, magic link, or any social/SSO providers desired.
  - Redirect URIs (AuthKit → Configuration → Redirects): `https://app.preview.agent-paste.sh/api/auth/callback`, `https://app.agent-paste.sh/api/auth/callback`, plus `http://localhost:5173/api/auth/callback` for local dev.
  - Allowed logout redirects: `https://app.preview.agent-paste.sh`, `https://app.agent-paste.sh`, `http://localhost:5173`.
  - Capture `WORKOS_CLIENT_ID` (preview + production, separate projects) and the corresponding `WORKOS_API_KEY` secrets.
- [ ] Add `app.agent-paste.sh` and `app.preview.agent-paste.sh` custom domains to the `agent-paste-web-production` and `agent-paste-web-preview` Workers (Cloudflare console).
- [ ] Generate a 32+ char cookie password for `WORKOS_COOKIE_PASSWORD` (one per environment) and store in Bitwarden under `agent-paste / workos cookie password preview` and `… production`.

## Bootstrap script (small follow-up PR)

- [x] Extend `scripts/bootstrap-secrets.mjs` to push the new web secrets to both Workers (`agent-paste-web-preview` and `agent-paste-web-production`):
  - `WORKOS_API_KEY`
  - `WORKOS_COOKIE_PASSWORD`
  - `WORKOS_CLIENT_ID` (also kept in `wrangler.jsonc` vars for non-secret reference; secret value lives only as a Worker secret)
  - `OPERATOR_EMAILS` (CSV)
- [x] Update the Worker-secrets table in `docs/ops/project-status.md` once these are present.

Implementation note: web secret setup is opt-in for first deploy. Plain CLI-first bootstrap still writes only the MVP `api`/`upload`/`content` secrets; passing `--with-web` or a complete WorkOS input set adds the `api` WorkOS bindings plus the `web` Worker bindings. `WORKOS_CLIENT_ID` is written through `wrangler secret put`; the `apps/api` and `apps/web` `wrangler.jsonc` vars remain non-secret deployment metadata/placeholders and are not edited by the script.

## DB schema (drives login completion)

- [x] Migration `packages/db/migrations/0004_workspace_members.sql`:
  - `workspace_members(id text pk, workspace_id uuid fk, workos_user_id text unique, email text, scopes jsonb not null default '[]', created_at timestamptz, last_seen_at timestamptz)`.
  - `workos_user_id` is globally unique: the Phase 3 WorkOS membership model still assumes one Personal Workspace per WorkOS user.
  - `scopes` defaults to `[]`: downstream provisioning and test seeds must grant member permissions explicitly instead of relying on a database default.
  - RLS policies mirroring ADR 0044: tenant policy keyed on `current_setting('app.workspace_id', true)`, platform policy for the resolve path.
  - Idempotent: Postgres does not support `CREATE POLICY IF NOT EXISTS`; use the Bug B / migration 0003 pattern of `DROP POLICY IF EXISTS … ON …; CREATE POLICY … ON …` for each policy so the migration is safe to re-run.
- [x] Add the Drizzle schema entry and refresh `packages/db/snapshot/schema.sql`; `pnpm db:check` must stay green.

## `api` endpoints (unblock the dashboard)

Order matters — each later item depends on the earlier ones.

- [x] `POST /v1/auth/web/callback` — verify the WorkOS access token via JWKS at `https://api.workos.com/sso/jwks/<client_id>`, match the `client_id` claim, upsert `workspace_members` row, return the web callback contract shape. Drives ADR 0055 + ADR 0059.
  - Done in `agents/workos-callback-api`: `apps/api` uses `jose.createRemoteJWKSet(new URL('https://api.workos.com/sso/jwks/' + client_id))` with a finite JWKS cache TTL, resolves the WorkOS user email server-side, extracts `session_id` from JWT `sid` and `token_id` from JWT `jti`, derives callback idempotency as `workos-jti:{jti}` or `workos-session:{sid}`, provisions the Personal Workspace + Workspace Member + default API Key through `runCommand`, keys first-time provisioning by `workos-user:{workos_user_id}` to prevent duplicate Personal Workspaces, and returns `{ workspace, workspace_member, scopes, default_api_key }`.
- [x] `GET /v1/web/workspace` — workspace name, usage policy, first-run default-key flag.
- [x] `GET /v1/web/artifacts` (cursor paginated) and `GET /v1/web/artifacts/{artifactId}`.
- [x] `GET /v1/web/keys`, `POST /v1/web/keys`, `POST /v1/web/keys/{id}/revoke`.
  - Done in `agents/next-three-status-items`: key create/revoke runs through WorkOS Workspace Member auth, requires `admin` scope and an `Idempotency-Key`, derives the Workspace from the member, writes `member` actor idempotency/audit rows, returns one-time secrets only on create/replay, and uses generic `not_found` for missing or cross-workspace revokes.
- [x] `GET /v1/web/audit` (cursor paginated).
  - Done in `agents/next-three-status-items`: accepts `limit` and opaque `cursor`, orders by `occurred_at desc, id desc`, and returns only Audit Events visible under the member Workspace RLS scope.
- [x] `GET /v1/web/settings`, `PATCH /v1/web/settings` (name, auto-deletion days).
  - Done in `agents/web-settings-patch` (#44): retention persists per-workspace via new `workspaces.auto_deletion_days` column (migration 0007, DB CHECK 1–90); `PATCH` runs through WorkOS member auth, requires `admin` scope + `Idempotency-Key`, bounds `auto_deletion_days` by the ADR 0048 caps (shared `MIN/MAX_AUTO_DELETION_DAYS`), and `RepositoryCore.updateWebSettings` fails closed against those bounds before persisting (local adapter has no DB constraint). Audit event `workspace.settings.updated`.
- [x] `POST /v1/web/admin/lockdowns` + `DELETE /v1/web/admin/lockdowns/{scope}/{target_id}` (operator-only; in production gated by Cloudflare Access then `requireOperator()`, which accepts a WorkOS operator session or the rotation agent's Access service token and rejects API-key auth outright, per ADR 0046).
  - Done in `agents/web-admin-lockdown`: new `operator` auth requirement + `apps/api/src/operator.ts` (OPERATOR_EMAILS allow-list + Cloudflare Access service-token JWT verification requiring `common_name`). All operator-route auth failures (missing/invalid WorkOS token, non-operator email, API-key bearer, missing/invalid Access JWT) collapse to a generic `not_found` (404) so the surface stays non-enumerable. New `platform` actor type, `platform_lockdowns` table (migration 0008, partial unique index on effective rows, forced RLS via `app.platform`), idempotent `setLockdown`/`liftLockdown` through `runCommand`, KV denylist `wsd:`/`ad:` writes on set and deletes on lift (after the Postgres commit). Operator routes rate-limit by `platform:{operator-id}` with no workspace dimension.
  - Deferred follow-up: no `GET` list/inspect endpoint for active lockdowns in this slice. Add `GET /v1/web/admin/lockdowns` (operator-only, paginated) when an operator dashboard needs to enumerate them.

All mutations through `runCommand` (ADR 0022/0035); all reads under the request's Workspace Member RLS scope (ADR 0044). New routes register Zod schemas in `packages/contracts` and the `openapi:check` golden regenerates.

## `web` follow-up wiring (lands after each `api` endpoint)

- [ ] Replace each route's `apiFetchOrEmpty(404|501) → EmptyState` fallback with the real loader call.
- [ ] First-run key card: render when `GET /v1/web/workspace` returns `default_key_first_run = true`; secret stays in component state only.
- [ ] Toasts surface `api` error envelopes: code + message + a link to `/audit?request_id=…`.

## Access Link viewer

Deferred to Phase 4 (decision D4, Phase 2/3 reconciliation). Access Links (ADR 0047/0052) depend on the `access_links` table, the kid signing-key family + rotation (ADR 0045), and multi-revision artifacts, none of which exist yet. The `/al/*` route, `POST /v1/access-links/resolve`, and the viewer land with Phase 4, not here.

## Smoke / CI

- [ ] Add `pnpm smoke:web` covering `/healthz` and `/login` 302 to the WorkOS hosted flow. Wire into `pnpm smoke:preview`.
- [ ] Extend the PR preview workflow to deploy `web` alongside `api`/`upload`/`content` with the right service binding (`agent-paste-api-pr-{N}`).
- [ ] Lighthouse a11y check on `/dashboard` (empty state). Fail the preview job below 95.

## Documentation

- [ ] `docs/ops/runbook-workos.md` — project config, rotation procedure, common failure modes (callback URL drift, expired API key, cookie password rotation).
- [ ] When the above lands, move the `apps/web` row in `docs/ops/project-status.md` from `Implemented (scaffold)` to `Implemented`; promote ADR 0033 and 0059 from `Partial` to `Done`; bump Phase 3 % beyond ~15.

## Polish / nice-to-have (not blocking)

- [ ] Cmd-K command palette across routes (style guide §6.3 alludes to a global search trigger).
- [ ] Per-route `<title>` and OG metadata.
- [ ] Storybook or Ladle for component review — only if it earns its keep.
