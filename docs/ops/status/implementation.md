# Implementation State

Last updated: 2026-05-25.

## Snapshot

- Local `main` and `origin/main` are aligned at
  `b7927d5 docs: competitor analysis and open-core billing ADRs (#67)`.
- Working tree was clean before this status-doc split.
- `pnpm verify` passed on 2026-05-25: 72 Turbo tasks successful.
- Last recorded hosted MVP smokes remain green from the 2026-05-22 production
  run and the later preview/web deploy checks recorded in the changelog.

## Components

| Component                 | Status                      | Notes                                                                                                                         |
| ------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `apps/apex`               | Implemented                 | Marketing/apex Worker, auth vanity redirects, agent-facing copy, and tests.                                                   |
| `apps/api`                | Implemented                 | Public Agent View, admin routes, scheduled MVP cleanup, dashboard APIs, WorkOS callback/member provisioning, operator APIs.   |
| `apps/upload`             | Implemented                 | Session create, signed upload-worker PUTs, R2 writes, finalize, signed view/Agent View URL minting.                           |
| `apps/content`            | Implemented                 | Signed content-token verification, private R2 reads, CSP/security headers, extension-derived MIME, denylist, read throttling. |
| `apps/cli`                | Implemented                 | `publish`, `whoami`, admin commands, `login`, `logout`, local credential storage, destructive `--yes` guards.                 |
| `apps/web`                | Implemented with gaps       | WorkOS AuthKit, dashboard routes, live loaders/mutations, deployed preview/production. Admin UI and Access Links remain.      |
| `apps/jobs`               | Scaffolded                  | Health/OpenAPI and empty scheduled handler only. No cron discovery, queues, DLQs, bundle, scan, or purge consumers.           |
| `apps/mcp`                | Scaffolded                  | Health/OpenAPI plus OAuth protected-resource metadata. No MCP transport, OAuth verifier, API forwarding, or tools.            |
| `packages/contracts`      | Implemented for current app | Zod schemas, route registry, OpenAPI goldens for current REST surfaces. Future MCP/Access Link/bundle schemas absent.         |
| `packages/worker-runtime` | Implemented                 | Contract-driven route registrar, request guard, auth principal model, error map, and rate-limit application.                  |
| `packages/db`             | Implemented for current app | Drizzle schema/migrations, RLS, repository core/adapters. Phase 4/billing tables are absent.                                  |
| `packages/tokens`         | Implemented                 | Shared signed-token codec and content, Agent View, upload URL token modules.                                                  |
| `packages/auth`           | Implemented                 | Admin token HMAC, auth cache, scope registry, request IDs.                                                                    |
| `packages/api-client`     | Implemented                 | CLI/web-facing client helpers, retry/idempotency/cursor handling, CLI key mint path.                                          |
| `packages/commands`       | Implemented                 | `runCommand`, operation events, idempotency helpers.                                                                          |
| `packages/storage`        | Implemented                 | MIME map and security header helpers.                                                                                         |
| `packages/config`         | Scaffolded                  | Constants/helpers only; no per-app env schema.                                                                                |
| `packages/repo-lint`      | Implemented                 | Repo policy checks and docs/scripts lint wiring.                                                                              |

## Planned But Absent

| Planned item       | Earliest phase | Current state                                                                                 |
| ------------------ | -------------- | --------------------------------------------------------------------------------------------- |
| `apps/stream`      | Phase 4        | Does not exist. Needed for ADR 0069 Live Updates.                                             |
| `packages/billing` | Post-launch    | Does not exist. Needed for ADR 0073/0074 once hosted billing is enabled.                      |
| Access Link tables | Phase 4        | `access_links` and related signing-key/link lifecycle storage are absent.                     |
| Jobs queues        | Phase 4        | No Cloudflare Queue bindings/consumers for `byte-purge`, `safety-scan`, or `bundle-generate`. |
| Bundle state       | Phase 4        | No bundle status columns, R2 bundle writer, or Agent View bundle output.                      |
| Safety warnings    | Phase 4/6      | No scanner/warning tables yet; ADR 0051 is still future work.                                 |

## Known Implementation Gaps

- `apps/jobs/src/index.ts` returns health and skips work unless disabled; there
  is no business logic in `runScheduledJobs`.
- `apps/mcp/src/index.ts` advertises protected-resource metadata but does not
  implement MCP JSON-RPC or authenticate tool calls.
- `apps/web/src/routes/_authed.admin.tsx` is still a placeholder despite the
  operator lockdown APIs existing.
- `apps/web/src/routes/al.$publicId.tsx` is a client placeholder and posts to
  `/al-resolve`; no matching route or Access Link resolve API exists.
- `packages/db` has current workspace/member/key/artifact/audit/lockdown state,
  but no multi-revision, Access Link, billing, bundle, or scanner persistence.

## Verification

| Check                   | Latest known result | Date       | Notes                                                                                          |
| ----------------------- | ------------------- | ---------- | ---------------------------------------------------------------------------------------------- |
| `pnpm verify`           | Pass                | 2026-05-25 | 72 Turbo tasks on `b7927d5`.                                                                   |
| `pnpm smoke:local`      | Pass                | 2026-05-24 | Last recorded after route registrar/token work.                                                |
| `pnpm smoke:preview`    | Pass                | 2026-05-24 | Preview web and WorkOS login were verified during Phase 3 work.                                |
| `pnpm smoke:production` | Pass                | 2026-05-22 | Full publish + Agent View + content fetch chain green after production deploy run 26291734441. |
| PR preview lifecycle    | Pass with caveat    | 2026-05-24 | End-to-end works; readiness gate still needs hardening for workers.dev propagation flakes.     |
