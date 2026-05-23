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

- [ ] Extend `scripts/bootstrap-secrets.mjs` to push the new web secrets to both Workers (`agent-paste-web-preview` and `agent-paste-web-production`):
  - `WORKOS_API_KEY`
  - `WORKOS_COOKIE_PASSWORD`
  - `WORKOS_CLIENT_ID` (also kept in `wrangler.jsonc` vars for non-secret reference; secret value lives only as a Worker secret)
  - `OPERATOR_EMAILS` (CSV)
- [ ] Update the Worker-secrets table in `docs/ops/project-status.md` once these are present.

## DB schema (drives login completion)

- [x] Migration `packages/db/migrations/0004_workspace_members.sql`:
  - `workspace_members(id text pk, workspace_id uuid fk, workos_user_id text unique, email text, scopes jsonb not null default '[]', created_at timestamptz, last_seen_at timestamptz)`.
  - RLS policies mirroring ADR 0044: tenant policy keyed on `current_setting('app.workspace_id', true)`, platform policy for the resolve path.
  - Idempotent: Postgres does not support `CREATE POLICY IF NOT EXISTS`; use the Bug B / migration 0003 pattern of `DROP POLICY IF EXISTS … ON …; CREATE POLICY … ON …` for each policy so the migration is safe to re-run.
- [x] Add the Drizzle schema entry and refresh `packages/db/snapshot/schema.sql`; `pnpm db:check` must stay green.

## `api` endpoints (unblock the dashboard)

Order matters — each later item depends on the earlier ones.

- [ ] `POST /v1/auth/web/callback` — verify the WorkOS access token via JWKS at `https://api.workos.com/sso/jwks/<client_id>`, match the `client_id` claim, upsert `workspace_members` row, return `{workspace_id, workspace_member_id, scopes}`. Drives ADR 0055 + ADR 0059. Until this exists, login completes the AuthKit cookie seal but the dashboard cannot resolve a Workspace Member, so every loader falls back to `EmptyState`.
  - Implementation note: use `jose.createRemoteJWKSet(new URL('https://api.workos.com/sso/jwks/' + client_id))` and match the `client_id` claim. The WorkOS JWKS API reference confirms access tokens carry `client_id` (the AuthKit Sessions docs page omits it from its list but the reference is authoritative). Cache the remote JWKS for the process lifetime.
- [ ] `GET /v1/web/workspace` — workspace name, usage policy, first-run default-key flag.
- [ ] `GET /v1/web/artifacts` (cursor paginated) and `GET /v1/web/artifacts/{artifactId}`.
- [ ] `GET /v1/web/keys`, `POST /v1/web/keys`, `POST /v1/web/keys/{id}/revoke`.
- [ ] `GET /v1/web/audit` (cursor paginated).
- [ ] `GET /v1/web/settings`, `PATCH /v1/web/settings` (name, auto-deletion days).
- [ ] `POST /v1/web/admin/lockdown/...` + `DELETE /v1/web/admin/lockdown/...` (operator-only; reject API-key auth before scope checks per ADR 0046).

All mutations through `runCommand` (ADR 0022/0035); all reads under the request's Workspace Member RLS scope (ADR 0044). New routes register Zod schemas in `packages/contracts` and the `openapi:check` golden regenerates.

## `web` follow-up wiring (lands after each `api` endpoint)

- [ ] Replace each route's `apiFetchOrEmpty(404|501) → EmptyState` fallback with the real loader call.
- [ ] First-run key card: render when `GET /v1/web/workspace` returns `default_key_first_run = true`; secret stays in component state only.
- [ ] Toasts surface `api` error envelopes: code + message + a link to `/audit?request_id=…`.

## Access Link viewer

- [ ] Confirm `POST /v1/access-links/resolve` shape lives in `packages/contracts` and is the canonical route `/al/*` calls. If the route doesn't exist yet, add it to `apps/api` per ADR 0047 + ADR 0052.
- [ ] End-to-end smoke a real Access Link against `app.preview.agent-paste.sh`.

## Smoke / CI

- [ ] Add `pnpm smoke:web` covering `/healthz`, `/login` 302 to the WorkOS hosted flow, `/al/{public_id}#blob` resolving through `api`. Wire into `pnpm smoke:preview`.
- [ ] Extend the PR preview workflow to deploy `web` alongside `api`/`upload`/`content` with the right service binding (`agent-paste-api-pr-{N}`).
- [ ] Lighthouse a11y check on `/dashboard` (empty state). Fail the preview job below 95.

## Documentation

- [ ] `docs/ops/runbook-workos.md` — project config, rotation procedure, common failure modes (callback URL drift, expired API key, cookie password rotation).
- [ ] When the above lands, move the `apps/web` row in `docs/ops/project-status.md` from `Implemented (scaffold)` to `Implemented`; promote ADR 0033 and 0059 from `Partial` to `Done`; bump Phase 3 % beyond ~15.

## Polish / nice-to-have (not blocking)

- [ ] Cmd-K command palette across routes (style guide §6.3 alludes to a global search trigger).
- [ ] Per-route `<title>` and OG metadata.
- [ ] Storybook or Ladle for component review — only if it earns its keep.
