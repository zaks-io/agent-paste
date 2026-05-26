# AP-12: Legacy Admin Route Migration Plan

Issue: AP-12. Retire the repo-local `/admin/*` + `ADMIN_TOKEN` operating path
after replacement paths and smokes are complete.

Unblocked by: AP-10 production Cloudflare Access/operator-path smoke passed on
2026-05-26.

Scope: inventory every legacy admin operation, map it to a replacement or
explicit removal, execute only low-risk migrations now, and leave remaining
`ADMIN_TOKEN` dependencies explicit.

## Current Inventory

Source of truth: `packages/contracts/src/routes.ts`, `apps/api/src/index.ts`,
`packages/api-client/src/index.ts`, and `apps/cli/src/index.ts`.

| Legacy path                                                                      | Current owner                         | Current use                                                                                               | Migration decision                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /admin/whoami`                                                              | non-contract API route                | Hosted/local smoke waits for admin-token auth readiness.                                                  | Remove with the legacy smoke path. AP-10 should use `/admin` web and `/v1/web/admin/lockdowns` for operator evidence instead.                                                                                                     |
| `POST /admin/workspaces`                                                         | contract `admin.workspaces.create`    | Operator bootstrap creates a workspace by email.                                                          | Replace ordinary onboarding with WorkOS JIT provisioning through web auth/CLI login. Keep only if a documented incident-recovery need remains.                                                                                    |
| `GET /admin/workspaces`                                                          | contract `admin.workspaces.list`      | Cross-workspace operator listing.                                                                         | Remove unless richer operator browsing is promoted. The member dashboard owns workspace self-service reads.                                                                                                                       |
| `POST /admin/workspaces/{workspace_id}/api-keys`                                 | contract `admin.apiKeys.create`       | Operator mints a publish/read API key and sees the secret once.                                           | Replace ordinary key creation with `POST /v1/web/keys` and `agent-paste login`. Avoid creating a broad operator key-mint route unless a recovery runbook requires it.                                                             |
| `DELETE /admin/api-keys/{api_key_id}`                                            | contract `admin.apiKeys.revoke`       | Operator revokes any API key.                                                                             | Replace own-workspace revocation with `DELETE /v1/web/keys/{api_key_id}`. Cross-workspace emergency response should prefer Platform Lockdown; add an operator revoke route only if incident runbooks still need key-level action. |
| `GET /admin/artifacts`                                                           | contract `admin.artifacts.list`       | Cross-workspace artifact listing.                                                                         | Replace own-workspace reads with `/v1/web/artifacts`. Cross-workspace investigation belongs in future operator browsing, not the public CLI/admin token.                                                                          |
| `GET /admin/artifacts/{artifact_id}`                                             | contract `admin.artifacts.get`        | Cross-workspace artifact inspection.                                                                      | Replace own-workspace detail with `/v1/web/artifacts/{artifact_id}`. Keep cross-workspace inspection as an explicit future operator-browsing gap if still needed.                                                                 |
| `DELETE /admin/artifacts/{artifact_id}`                                          | contract `admin.artifacts.delete`     | Hard-deletes DB state, writes denylist, and purges R2 bytes.                                              | Do not port this directly. Use Platform Lockdown for immediate takedown. Move byte purge/deletion lifecycle to `apps/jobs` before deleting the legacy route.                                                                      |
| `POST /admin/cleanup/run`                                                        | contract `admin.cleanup.run`          | Manual cleanup expires artifacts/sessions and purges R2 bytes. Scheduled cleanup already exists in `api`. | Remove manual admin-token trigger after smoke scripts no longer require it and Phase 4 jobs owns lifecycle cleanup.                                                                                                               |
| `GET /admin/operation-events`                                                    | contract `admin.operationEvents.list` | Cross-workspace operation-event browsing.                                                                 | Replace own-workspace audit with `/v1/web/audit`. Cross-workspace audit feed remains future operator browsing.                                                                                                                    |
| `POST /__test__/force-expire`, `GET /__test__/r2-list`, `GET /__test__/denylist` | non-production test routes            | Hosted smoke harness forces expiry and verifies R2/KV effects using `ADMIN_TOKEN`.                        | Not production `/admin/*`, but still an `ADMIN_TOKEN` dependency. Rewrite smokes before AP-13 retirement.                                                                                                                         |

## Replacement Paths Already Available

- WorkOS member provisioning: `POST /v1/auth/web/callback` creates a Personal
  Workspace, member row, and one default API key on first authenticated use.
- CLI login: `agent-paste login` mints a publish/read API key through
  `POST /v1/web/keys`.
- Dashboard key lifecycle: `GET /v1/web/keys`, `POST /v1/web/keys`, and
  `DELETE /v1/web/keys/{api_key_id}` cover member-managed API keys.
- Dashboard workspace/artifact/audit reads: `/v1/web/workspace`,
  `/v1/web/artifacts`, `/v1/web/artifacts/{artifact_id}`, and `/v1/web/audit`
  cover tenant-scoped browsing.
- Operator lockdown: `GET /v1/web/admin/lockdowns`,
  `POST /v1/web/admin/lockdowns`, and
  `DELETE /v1/web/admin/lockdowns/{scope}/{target_id}` cover reversible
  platform takedown. They use WorkOS operator auth or Cloudflare Access
  service-token auth and return generic `not_found` failures.

## Execution Plan

1. Complete AP-10 first.
   Done on 2026-05-26: `/admin` and `/v1/web/admin/lockdowns` are edge-gated by
   Cloudflare Access and app-gated by operator auth.

2. Freeze legacy admin route additions.
   Add a docs/code note that new operator functionality must use WorkOS/operator
   route contracts, not `auth: "admin_token"`. Keep existing routes only as
   migration targets.

3. Migrate safe self-service dependencies.
   Update docs and smoke expectations so ordinary workspace creation and API-key
   lifecycle use WorkOS provisioning, dashboard key routes, and CLI login. Do
   not add operator workspace/key routes unless a concrete bootstrap or
   recovery flow remains after the WorkOS paths are exercised.

4. Replace incident takedown behavior.
   Treat Platform Lockdown as the immediate replacement for
   `DELETE /admin/artifacts/{artifact_id}`. Leave destructive deletion and R2
   purge in the legacy path until Phase 4 jobs owns byte purge and retention.

5. Rewrite smoke/admin-token harness dependencies.
   Inventory `scripts/smoke-hosted.mjs`, `scripts/smoke-web-api.mjs`,
   `scripts/lighthouse-dashboard-a11y.mjs`, and local server setup for
   `AGENT_PASTE_ADMIN_TOKEN`. Replace readiness checks with `/healthz` or
   AP-10 operator smoke checks where possible. Keep non-production test helpers
   only if they no longer require the production `ADMIN_TOKEN` posture.

6. Update contracts and clients.
   Once replacement coverage exists, remove `admin.*` route contracts from
   `packages/contracts`, remove `client.admin.*` from `packages/api-client`, and
   remove `agent-paste admin ...` commands from the CLI. Regenerate OpenAPI.

7. Retire secrets in AP-13.
   After all callers are gone, remove `ADMIN_TOKEN`/`ADMIN_TOKEN_HASH` from
   bootstrap scripts, deploy/preview scripts, smoke configuration, hosted ops
   docs, and Worker secrets. AP-12 should not remove the secrets itself.

## Remaining Dependencies To Keep Explicit

- Hosted smoke currently depends on `ADMIN_TOKEN` for setup, forced expiry,
  cleanup, R2 listing, and denylist verification.
- Manual cleanup still lives in `api`; Phase 4 jobs is the long-term owner.
- Cross-workspace operator artifact/event browsing is not replaced yet. Either
  promote richer operator browsing or remove that operational requirement.
- Destructive artifact deletion should not be copied into the new operator API
  before byte purge and retention are owned by jobs.

## Verification

- Focused tests after each migration slice:
  `pnpm --filter @agent-paste/contracts test`,
  `pnpm --filter @agent-paste/api test`,
  `pnpm --filter @agent-paste/api-client test`,
  `pnpm --filter agent-paste test`.
- Full repo gate before PR: `pnpm verify`.
- Hosted production smoke only with explicit approval and credentials.
