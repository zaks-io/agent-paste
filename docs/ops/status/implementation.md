# Implementation State

Last updated: 2026-05-26.

## Snapshot

- Local `main` and `origin/main` are aligned at
  `a3da446 test: restore AP-16 coverage gate`.
- Working tree was clean before this status-doc split.
- `pnpm verify` passed on 2026-05-26: 76 Turbo tasks successful.
- Last recorded hosted MVP smokes remain green from the 2026-05-22 production
  run and the later preview/web deploy checks recorded in the changelog.

## Components

| Component                 | Status                      | Notes                                                                                                                                                                                                                                                                                                              |
| ------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/apex`               | Implemented                 | Marketing/apex Worker, auth vanity redirects, agent-facing copy, and tests.                                                                                                                                                                                                                                        |
| `apps/api`                | Implemented                 | Public Agent View, scheduled MVP cleanup, dashboard APIs, WorkOS callback/member provisioning, operator APIs, operator event browsing, revision publish/list.                                                                                                                                                      |
| `apps/upload`             | Implemented                 | Session create (including update sessions), signed upload-worker PUTs, R2 writes, finalize to draft revision.                                                                                                                                                                                                      |
| `apps/content`            | Implemented                 | Signed content-token verification, private R2 reads, CSP/security headers, extension-derived MIME, denylist, read throttling.                                                                                                                                                                                      |
| `apps/cli`                | Implemented                 | `publish` (finalize + publish), optional `--artifact-id` updates, `whoami`, `login`, `logout`, local credential storage, and API-client plumbing.                                                                                                                                                                  |
| `apps/web`                | Implemented with gaps       | WorkOS AuthKit, dashboard routes, live loaders/mutations, operator lockdown UI, operator event browsing, Lighthouse a11y gate, hardened PR-preview readiness, deployed preview/production. Access Link `/al/{publicId}` viewer and resolve proxy route ship; dashboard Access Link management UI remains deferred. |
| `apps/jobs`               | Scaffolded                  | Health/OpenAPI and empty scheduled handler only. No cron discovery, queues, DLQs, bundle, scan, or purge consumers.                                                                                                                                                                                                |
| `apps/mcp`                | Scaffolded                  | Health/OpenAPI plus OAuth protected-resource metadata. No MCP transport, OAuth verifier, API forwarding, or tools.                                                                                                                                                                                                 |
| `packages/contracts`      | Implemented for current app | Zod schemas, route registry, OpenAPI goldens for current REST surfaces including Access Link resolve request/response. MCP transport schemas and bundle contracts still absent.                                                                                                                                    |
| `packages/worker-runtime` | Implemented                 | Contract-driven route registrar, request guard, auth principal model, error map, and rate-limit application.                                                                                                                                                                                                       |
| `packages/db`             | Implemented for current app | Drizzle schema/migrations, RLS, repository core/adapters, `revisions` table and publish-update flow. AP-19 Access Link model/codec/mint-revoke persistence landed; billing/bundle/scanner persistence still absent.                                                                                                |
| `packages/tokens`         | Implemented                 | Shared signed-token codec and content, Agent View, upload URL token modules.                                                                                                                                                                                                                                       |
| `packages/auth`           | Implemented                 | Admin token HMAC, auth cache, scope registry, request IDs.                                                                                                                                                                                                                                                         |
| `packages/api-client`     | Implemented                 | CLI/web-facing client helpers, retry/idempotency/cursor handling, CLI key mint path.                                                                                                                                                                                                                               |
| `packages/commands`       | Implemented                 | `runCommand`, operation events, idempotency helpers.                                                                                                                                                                                                                                                               |
| `packages/storage`        | Implemented                 | MIME map and security header helpers.                                                                                                                                                                                                                                                                              |
| `packages/config`         | Scaffolded                  | Constants/helpers only; no per-app env schema.                                                                                                                                                                                                                                                                     |
| `packages/repo-lint`      | Implemented                 | Repo policy checks and docs/scripts lint wiring.                                                                                                                                                                                                                                                                   |

## Planned But Absent

| Planned item       | Earliest phase | Current state                                                                                                                                                                                                          |
| ------------------ | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/stream`      | Phase 4        | Does not exist. Needed for ADR 0069 Live Updates.                                                                                                                                                                      |
| `packages/billing` | Post-launch    | Does not exist. Needed for ADR 0073/0074 once hosted billing is enabled.                                                                                                                                               |
| Access Link tables | Phase 4        | `access_links` migration, lockdown column, signed-url codec, mint/revoke helpers (AP-19), and `POST /v1/access-links/resolve` plus `/al/{publicId}` viewer (AP-20) landed. Dashboard link management UI still pending. |
| Jobs queues        | Phase 4        | No Cloudflare Queue bindings/consumers for `byte-purge`, `safety-scan`, or `bundle-generate`.                                                                                                                          |
| Bundle state       | Phase 4        | No bundle status columns, R2 bundle writer, or Agent View bundle output.                                                                                                                                               |
| Safety warnings    | Phase 4/6      | No scanner/warning tables yet; ADR 0051 is still future work.                                                                                                                                                          |

## Known Implementation Gaps

- `apps/jobs/src/index.ts` returns health and skips work unless disabled; there
  is no business logic in `runScheduledJobs`.
- `apps/mcp/src/index.ts` advertises protected-resource metadata but does not
  implement MCP JSON-RPC or authenticate tool calls.
- `apps/web/src/routes/_authed.admin.tsx` now exposes the Phase 3 operator
  lockdown UI plus AP-16 operator event browsing over WorkOS operator APIs.
- Dashboard Access Link list/create/mint UI on `/access-links` and artifact detail
  remain `EmptyState` placeholders (management APIs not wired in this slice).
- `packages/db` has workspace/member/key/artifact/revision/audit/lockdown state
  plus AP-19 Access Link rows and lockdown helpers; billing, bundle, and scanner
  persistence remain absent.

## Verification

| Check                   | Latest known result | Date       | Notes                                                                                                                           |
| ----------------------- | ------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm verify`           | Pass                | 2026-05-26 | 76 Turbo tasks on `a3da446`.                                                                                                    |
| `pnpm smoke:local`      | Pass                | 2026-05-24 | Last recorded after route registrar/token work.                                                                                 |
| `pnpm smoke:preview`    | Pass                | 2026-05-24 | Preview web and WorkOS login were verified during Phase 3 work.                                                                 |
| `pnpm smoke:production` | Pass                | 2026-05-22 | Full publish + Agent View + content fetch chain green after production deploy run 26291734441.                                  |
| PR preview lifecycle    | Pass                | 2026-05-25 | Readiness gate polls `/healthz` with consecutive 200s and retries 404/530 flakes; docs-only PRs skip deploy via `paths-ignore`. |
