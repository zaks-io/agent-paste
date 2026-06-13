# Admin Operations

The repo-local `ADMIN_TOKEN` `/admin/*` API and `agent-paste admin ...` CLI were removed in AP-13. They are not part of the product surface.

## Current operator paths

- **Human operators:** WorkOS `admin` role, Cloudflare Access on `app.agent-paste.sh/admin` and `/v1/web/admin/*`, and the web operator UI. See [ADR 0046](../adr/0046-operator-identity-and-web-admin-surface.md).
- **Platform Lockdown:** `GET`/`POST /v1/web/admin/lockdowns` and `DELETE /v1/web/admin/lockdowns/{scope}/{target_id}` cover reversible artifact/workspace takedown.
- **Operator events:** `GET /v1/web/admin/events` supports cross-workspace operator event browsing for audit and abuse triage.
- **Billing override:** `POST /v1/web/admin/workspaces/{workspace_id}/plan` sets or clears the operator plan override.
- **Members:** WorkOS AuthKit provisioning, dashboard key lifecycle (`/v1/web/keys`), and `agent-paste login` for CLI keys. See [ADR 0068](../adr/0068-workos-authkit-for-web-and-cli.md).
- **Scheduled cleanup:** the API Worker cron uses a system actor; it does not require a bearer admin token.

## Non-production smoke harness

Preview, PR, and local smoke tests provision workspaces through `POST /__test__/provision-smoke` and related `__test__/*` helpers. Those routes are gated by an explicit `AGENT_PASTE_ENV` allowlist (`preview` or `dev`) and `SMOKE_HARNESS_SECRET`; unknown, empty, and production-like values resolve as production and disable the harness. They are not operator credentials and must never be documented as a bootstrap path for humans.

Production hosted smoke uses a long-lived `AGENT_PASTE_PRODUCTION_SMOKE_API_KEY` GitHub secret instead of the harness.

## Historical note

The former admin CLI covered workspace bootstrap, cross-workspace artifact inspection, manual cleanup, and destructive deletes. Replacement mapping lives in [AP-12 migration plan](../ops/ap-12-migration-plan.md).
