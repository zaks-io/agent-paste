# Implementation State

Last updated: 2026-06-02 (AP-112 runbook).

## Snapshot

- Local `main` and `origin/main` are aligned at
  `777db63 Add hosted ephemeral publish smoke for preview, PR, and production (#172)`.
- AP-99 through AP-111 add Ephemeral Workspace provisioning, claim, CLI
  `--ephemeral`, web claim UX, script-disabled/noindex serving, and local +
  hosted ephemeral smokes. Operator notes:
  [`runbook-ephemeral-publish.md`](../runbook-ephemeral-publish.md).
- Last recorded `pnpm verify` passed on 2026-05-28: 80 Turbo tasks successful.
- Last recorded hosted MVP smokes remain green from the 2026-05-22 production
  run and the later preview/web deploy checks recorded in the changelog.

## Components

| Component                 | Status                      | Notes                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/apex`               | Implemented                 | Marketing/apex Worker, auth vanity redirects, agent-facing copy, and tests.                                                                                                                                                                                                                                                                                 |
| `apps/api`                | Implemented                 | Public Agent View, dashboard APIs, WorkOS callback/member provisioning, operator APIs, operator event browsing, revision publish/list, `POST /v1/ephemeral/provision`, and `POST /v1/ephemeral/claim`.                                                                                                                                                      |
| `apps/upload`             | Implemented                 | Session create (including update sessions), signed upload-worker PUTs, R2 writes, finalize to draft revision.                                                                                                                                                                                                                                               |
| `apps/content`            | Implemented                 | Signed content-token verification, private R2 reads/decrypt, CSP/security headers, noindex ephemeral serving, script-disabled ephemeral CSP via content-token bit, extension-derived MIME, denylist, read throttling.                                                                                                                                       |
| `apps/cli`                | Implemented                 | `publish` (finalize + publish) with `--ephemeral`, optional `--artifact-id` updates, `whoami`, `login`, `logout`, local credential storage, and API-client plumbing.                                                                                                                                                                                        |
| `apps/web`                | Implemented with gaps       | WorkOS AuthKit, dashboard routes, live loaders/mutations, operator lockdown UI, operator event browsing, Lighthouse a11y gate, hardened PR-preview readiness, deployed preview/production. Access Link `/al/{publicId}` viewer and resolve proxy route ship; dashboard Access Link management UI remains deferred.                                          |
| `apps/jobs`               | Implemented for current app | Cron discovery (upload cleanup, 24h ephemeral auto-deletion, auto-deletion skipping pinned artifacts, retention for non-current revisions, billing reconciliation, purge recovery, maintenance GC), queue consumers + DLQs, bundle zip generation + DLQ `mark_failed`, built-in and ephemeral-tier safety scan warning replacement (AP-21/22/23/24/33/104). |
| `apps/mcp`                | Implemented                 | Streamable HTTP MCP transport, WorkOS JWT verification, twelve-tool surface, API/upload forwarding, hosted/local smoke (`pnpm smoke:mcp`). See [`docs/ops/runbook-mcp-hosts.md`](../runbook-mcp-hosts.md).                                                                                                                                                  |
| `apps/stream`             | Implemented                 | Live Updates Worker (ADR 0069): per-artifact Durable Objects, SSE fan-out, `stream -> api` authorize binding, viewer cap (AP-25).                                                                                                                                                                                                                           |
| `packages/contracts`      | Implemented for current app | Zod schemas, route registry, OpenAPI goldens for current REST surfaces including Access Link resolve request/response and status-discriminated bundle availability. MCP OAuth scopes, JSON-RPC transport shapes, twelve-tool registry, error mapping, and forwarded API call plans (AP-27).                                                                 |
| `packages/worker-runtime` | Implemented                 | Contract-driven route registrar, request guard, auth principal model, error map, and rate-limit application.                                                                                                                                                                                                                                                |
| `packages/db`             | Implemented for current app | Drizzle schema/migrations, RLS, repository core/adapters, `revisions` table with bundle availability columns and publish-update flow. Access Links, Safety Warnings, `workspace_billing`, `claim_tokens`, and Ephemeral Workspace provisioning are present.                                                                                                 |
| `packages/tokens`         | Implemented                 | Shared signed-token codec and content, Agent View, upload URL, Access Link, and proof-of-work modules.                                                                                                                                                                                                                                                      |
| `packages/auth`           | Implemented                 | WorkOS/MCP auth primitives, auth cache, scope registry, and request IDs.                                                                                                                                                                                                                                                                                    |
| `packages/api-client`     | Implemented                 | CLI/web-facing client helpers, retry/idempotency/cursor handling, CLI key mint path.                                                                                                                                                                                                                                                                        |
| `packages/commands`       | Implemented                 | `runCommand`, operation events, idempotency helpers.                                                                                                                                                                                                                                                                                                        |
| `packages/storage`        | Implemented                 | MIME map, security header helpers, and app-layer Artifact bytes encryption/decryption helpers.                                                                                                                                                                                                                                                              |
| `packages/config`         | Implemented                 | Shared config constants including ephemeral auto-deletion policy.                                                                                                                                                                                                                                                                                           |
| `packages/billing`        | Partial                     | Plan tiers, `BillingProvider` adapters, sync/reconciliation, and drift logging are implemented; Checkout/webhooks/Portal remain for AP-5.                                                                                                                                                                                                                   |
| `packages/rotation`       | Implemented                 | Signing/content/API-pepper/WorkOS/artifact-bytes key-ring helpers plus rotation scripts/tests.                                                                                                                                                                                                                                                              |
| `packages/repo-lint`      | Implemented                 | Repo policy checks and docs/scripts lint wiring.                                                                                                                                                                                                                                                                                                            |

## Planned But Absent

| Planned item                    | Earliest phase | Current state                                                                                                 |
| ------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------- |
| Stripe Checkout/webhooks/Portal | Post-launch    | Not implemented; AP-5 remains the main billing code gap.                                                      |
| Hosted billing UI               | Post-launch    | Not implemented; plan state exists, but no member/operator billing UI.                                        |
| Ephemeral claim/upgrade funnel  | Post-launch    | Provision, claim API, CLI `--ephemeral`, web `/claim`, and smokes ship; AP-109 upgrade funnel polish remains. |
| Access Link management UI       | Phase 4        | `access_links` storage/codec/resolve/viewer landed. Dashboard link management UI still pending.               |

## Known Implementation Gaps

- Future jobs hardening may add new queue families, but lifecycle byte purge,
  retention, bundle zip generation, DLQ terminal failure handling, and safety
  warning replacement are implemented.
- `apps/mcp` ships OAuth-only MCP with local and hosted smoke; see
  [`docs/ops/runbook-mcp-hosts.md`](../runbook-mcp-hosts.md).
- `apps/web/src/routes/_authed.admin.tsx` now exposes the Phase 3 operator
  lockdown UI plus AP-16 operator event browsing over WorkOS operator APIs.
- Dashboard Access Link list/create/mint UI on `/access-links` and artifact detail
  remain `EmptyState` placeholders (management APIs not wired in this slice).
- `packages/db` has workspace/member/key/artifact/revision/audit/lockdown state
  plus Access Link rows, bundle availability, Safety Warning persistence,
  `workspace_billing`, and `claim_tokens`.

## Verification

| Check                   | Latest known result | Date       | Notes                                                                                                                           |
| ----------------------- | ------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm verify`           | Pass                | 2026-05-28 | 80 Turbo tasks on AP-33 branch.                                                                                                 |
| `pnpm smoke:local`      | Pass                | 2026-05-24 | Last recorded after route registrar/token work.                                                                                 |
| `pnpm smoke:preview`    | Pass                | 2026-05-24 | Preview web and WorkOS login were verified during Phase 3 work.                                                                 |
| `pnpm smoke:production` | Pass                | 2026-05-22 | Full publish + Agent View + content fetch chain green after production deploy run 26291734441.                                  |
| PR preview lifecycle    | Pass                | 2026-05-25 | Readiness gate polls `/healthz` with consecutive 200s and retries 404/530 flakes; docs-only PRs skip deploy via `paths-ignore`. |
