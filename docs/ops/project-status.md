# Project Status

Last updated: 2026-05-27 (AP-22 jobs lifecycle byte purge ownership).

This is the first status file to read after `AGENTS.md`, `CONTEXT.md`,
`docs/specs/README.md`, and `docs/adr/README.md`. It answers the current state
and points to the smaller ledgers that own detail.

## Snapshot

- `main` and `origin/main` are aligned at
  `a3da446 test: restore AP-16 coverage gate`.
- `pnpm verify` passed on 2026-05-26 with 76 Turbo tasks.
- Phase 1, the CLI-first MVP, is functionally complete.
- Phase 3, public OAuth + web dashboard + CLI login, is complete.
- `apps/jobs` has queue/cron/DLQ topology (AP-21); `apps/mcp` remains a scaffold for Phase 5.
- `apps/stream`, `packages/billing`, Access Link persistence, bundle state, and
  scanner persistence do not exist yet.
- Known security/ops debt: Cloudflare Access now gates the production operator
  web/API paths, and the hosted API environments now carry the app-side
  `CF_ACCESS_AUD` Wrangler secret. Production service-token/JWT smoke passed for
  `/v1/web/admin/lockdowns` on 2026-05-26, and the approved human browser
  `/admin` check passed after the WorkOS `admin` role assignment. The repo-local
  `ADMIN_TOKEN` `/admin/*` path is retired (AP-13); operator work uses WorkOS +
  `/v1/web/admin/*`, operator event browsing is implemented (AP-16), and
  non-production smokes use `SMOKE_HARNESS_SECRET`.

## Status Ledgers

- [Phase backlog](./status/phase-backlog.md) - ordered remaining work by phase.
- [Implementation state](./status/implementation.md) - app/package map,
  scaffolded surfaces, missing planned packages/apps, and verification.
- [Coverage ledger](./status/coverage.md) - spec and ADR coverage, including
  drift and deferred work.
- [Hosted ops](./status/hosted-ops.md) - environments, secrets, deploy order,
  and ops gaps.
- [Changelog](./status/changelog.md) - completed work, newest first.

Feature-specific ledgers:

- [Web app todo](./web-app-todo.md) - Phase 3 web/dashboard close-out.
- [Live Updates todo](./live-updates-todo.md) - ADR 0069, parked until Phase 4
  dependencies exist.
- [Repository todo](./repository-todo.md) - repository-core follow-ups.
- [Operator Access smoke plan (AP-10)](./ap-10-access-smoke-plan.md) -
  production Cloudflare Access + app-side operator auth smoke plan.
- [Admin route migration plan (AP-12)](./ap-12-migration-plan.md) - retire
  `/admin/*` `ADMIN_TOKEN` in favor of WorkOS/operator routes and jobs.
- [Rotation runbook](./runbook-rotation.md) - current manual rotation and future
  automation gaps.
- [Neon database roles runbook](./runbook-neon-database-roles.md) - migration vs
  Hyperdrive credential boundaries (AP-18).
- [WorkOS runbook](./runbook-workos.md) - WorkOS project config, redirect URI
  drift, auth failures, and verification.
- [Logpush runbook](./runbook-logpush.md) - parked Cloudflare Logpush -> Axiom
  work.

## Current Phase

Phase 3 is complete. WorkOS project setup, web AuthKit integration, CLI
login, dashboard data loaders, key lifecycle, audit reads, settings mutation,
operator lockdown APIs, preview/production web deploys, hosted web auth smoke,
and deep-link return paths are implemented.

## Not Yet Implemented From The Docs

Highest-signal gaps:

- Phase 4: multi-revision artifacts, Access Links, link resolve/mint/revoke,
  full jobs lifecycle sweeps, bundles, pinning, revision retention, and Live Updates.
- Phase 5: OAuth-only MCP transport, auth verification, API forwarding, and MCP
  tools.
- Phase 6: app-layer byte encryption, real safety scanner, stronger audit/abuse
  operations beyond the current operator event browsing baseline; rotation
  overlap rings and tests ship in `@agent-paste/rotation` (hosted wrangler
  automation still manual).
- Parked ops/security hardening: optional dedicated admin hostname decision.
- Post-launch: open-core billing, plan tiers, Stripe sync, billing UI, and jobs
  reconciliation.

See [phase-backlog.md](./status/phase-backlog.md) for implementation order and
[coverage.md](./status/coverage.md) for the spec/ADR ledger.

## Current Implementation Reality

- Implemented: `apex`, `api`, `upload`, `content`, `cli`, most of `web`,
  `contracts`, `worker-runtime`, `db`, `tokens`, `rotation`, `auth`, `api-client`,
  `commands`, `storage`, and repo guardrail packages.
- Partial: `jobs` (queue topology and lifecycle byte purge/retention landed; bundle generation authority still follow-ups).
- Scaffolded only: `mcp`.
- Placeholder UI: `web` Access Links.
- Absent: `stream`, `billing`, bundle zip generation, safety-warning storage,
  app-layer encryption.

Full component map:
[implementation.md](./status/implementation.md#components).

## Parked For Later

- Logpush -> Axiom wiring remains documented in
  [runbook-logpush.md](./runbook-logpush.md).
- Production deploy gate/wait-timer/vault posture remains parked in
  [hosted-ops.md](./status/hosted-ops.md#open-ops-items).
- Billing ADRs 0073/0074 are accepted but intentionally post-launch.

## Maintenance Rules

- Keep this file short and current.
- Move historical completion detail to [changelog.md](./status/changelog.md).
- Move active and future implementation detail to
  [phase-backlog.md](./status/phase-backlog.md).
- Update [coverage.md](./status/coverage.md) when ADR/spec status changes.
- Update [implementation.md](./status/implementation.md) when an app/package
  changes state.
