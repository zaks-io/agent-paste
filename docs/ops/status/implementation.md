# Implementation State

Last updated: 2026-05-28.

## Snapshot

- Local `main` and `origin/main` are aligned at
  `76a88a9 chore: add codex repo agent links`.
- AP-33 adds built-in safety scanning plus persisted Safety Warnings on this
  branch.
- `pnpm verify` passed on 2026-05-28: 80 Turbo tasks successful.
- Last recorded hosted MVP smokes remain green from the 2026-05-22 production
  run and the later preview/web deploy checks recorded in the changelog.

## Components

| Component                 | Status                      | Notes                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/apex`               | Implemented                 | Marketing/apex Worker, auth vanity redirects, agent-facing copy, and tests.                                                                                                                                                                                                                                                                                                                                     |
| `apps/api`                | Implemented                 | Public Agent View, dashboard APIs, WorkOS callback/member provisioning, operator APIs, operator event browsing, revision publish/list.                                                                                                                                                                                                                                                                          |
| `apps/upload`             | Implemented                 | Session create (including update sessions), signed upload-worker PUTs, R2 writes, finalize to draft revision.                                                                                                                                                                                                                                                                                                   |
| `apps/content`            | Implemented                 | Signed content-token verification, private R2 reads, CSP/security headers, extension-derived MIME, denylist, read throttling.                                                                                                                                                                                                                                                                                   |
| `apps/cli`                | Implemented                 | `publish` (finalize + publish), optional `--artifact-id` updates, `whoami`, `login`, `logout`, local credential storage, and API-client plumbing.                                                                                                                                                                                                                                                               |
| `apps/web`                | Implemented with gaps       | WorkOS AuthKit, dashboard routes, live loaders/mutations, operator lockdown UI, operator event browsing, Lighthouse a11y gate, hardened PR-preview readiness, deployed preview/production. Access Link `/al/{publicId}` viewer and resolve proxy route ship; dashboard Access Link management UI remains deferred.                                                                                              |
| `apps/jobs`               | Implemented for current app | Cron discovery (upload cleanup, auto-deletion skipping pinned artifacts, retention for non-current revisions when `revision_retention_days` is set - `rd:` denylist keys plus revision-scoped `byte-purge` enqueue before `retained` status - purge recovery, maintenance GC), queue consumers + DLQs, bundle zip generation + DLQ `mark_failed`, built-in safety scan warning replacement (AP-21/22/23/24/33). |
| `apps/mcp`                | Implemented                 | Streamable HTTP MCP transport, WorkOS JWT verification, twelve-tool surface, API/upload forwarding, hosted/local smoke (`pnpm smoke:mcp`). See [`docs/ops/runbook-mcp-hosts.md`](../runbook-mcp-hosts.md).                                                                                                                                                                                                      |
| `apps/stream`             | Implemented                 | Live Updates Worker (ADR 0069): per-artifact Durable Objects, SSE fan-out, `stream -> api` authorize binding, viewer cap (AP-25).                                                                                                                                                                                                                                                                               |
| `packages/contracts`      | Implemented for current app | Zod schemas, route registry, OpenAPI goldens for current REST surfaces including Access Link resolve request/response and status-discriminated bundle availability. MCP OAuth scopes, JSON-RPC transport shapes, twelve-tool registry, error mapping, and forwarded API call plans (AP-27).                                                                                                                     |
| `packages/worker-runtime` | Implemented                 | Contract-driven route registrar, request guard, auth principal model, error map, and rate-limit application.                                                                                                                                                                                                                                                                                                    |
| `packages/db`             | Implemented for current app | Drizzle schema/migrations, RLS, repository core/adapters, `revisions` table with bundle availability columns and publish-update flow. AP-19 Access Link model/codec/mint-revoke persistence landed; AP-33 Safety Warning persistence landed; billing remains absent.                                                                                                                                            |
| `packages/tokens`         | Implemented                 | Shared signed-token codec and content, Agent View, upload URL token modules.                                                                                                                                                                                                                                                                                                                                    |
| `packages/auth`           | Implemented                 | Admin token HMAC, auth cache, scope registry, request IDs.                                                                                                                                                                                                                                                                                                                                                      |
| `packages/api-client`     | Implemented                 | CLI/web-facing client helpers, retry/idempotency/cursor handling, CLI key mint path.                                                                                                                                                                                                                                                                                                                            |
| `packages/commands`       | Implemented                 | `runCommand`, operation events, idempotency helpers.                                                                                                                                                                                                                                                                                                                                                            |
| `packages/storage`        | Implemented                 | MIME map and security header helpers.                                                                                                                                                                                                                                                                                                                                                                           |
| `packages/config`         | Scaffolded                  | Constants/helpers only; no per-app env schema.                                                                                                                                                                                                                                                                                                                                                                  |
| `packages/repo-lint`      | Implemented                 | Repo policy checks and docs/scripts lint wiring.                                                                                                                                                                                                                                                                                                                                                                |

## Planned But Absent

| Planned item       | Earliest phase | Current state                                                                                                                                                                                                          |
| ------------------ | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/billing` | Post-launch    | Does not exist. Needed for ADR 0073/0074 once hosted billing is enabled.                                                                                                                                               |
| Access Link tables | Phase 4        | `access_links` migration, lockdown column, signed-url codec, mint/revoke helpers (AP-19), and `POST /v1/access-links/resolve` plus `/al/{publicId}` viewer (AP-20) landed. Dashboard link management UI still pending. |
| Jobs queues        | Phase 4        | `apps/jobs` has Wrangler queue/DLQ bindings, consumers, lifecycle sweeps, `bundle-generate` + DLQ consumers, retention, and safety scan replacement (AP-21-24, AP-33).                                                 |
| Bundle state       | Phase 4        | AP-23 landed: revision `bundle_status` columns, jobs zip writer with size-cap failure, signed `/b/{token}` download, and Agent View bundle availability (pending/ready/failed/disabled).                               |
| Safety warnings    | Phase 4/6      | AP-33 landed `safety_warnings`, scanner versioning, async replacement, and Agent View surfacing.                                                                                                                       |

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
  plus AP-19 Access Link rows and lockdown helpers, AP-23 bundle availability on
  revisions, and AP-33 Safety Warning persistence; billing remains absent.

## Verification

| Check                   | Latest known result | Date       | Notes                                                                                                                           |
| ----------------------- | ------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm verify`           | Pass                | 2026-05-28 | 80 Turbo tasks on AP-33 branch.                                                                                                 |
| `pnpm smoke:local`      | Pass                | 2026-05-24 | Last recorded after route registrar/token work.                                                                                 |
| `pnpm smoke:preview`    | Pass                | 2026-05-24 | Preview web and WorkOS login were verified during Phase 3 work.                                                                 |
| `pnpm smoke:production` | Pass                | 2026-05-22 | Full publish + Agent View + content fetch chain green after production deploy run 26291734441.                                  |
| PR preview lifecycle    | Pass                | 2026-05-25 | Readiness gate polls `/healthz` with consecutive 200s and retries 404/530 flakes; docs-only PRs skip deploy via `paths-ignore`. |
