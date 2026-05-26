# Project Status

Last updated: 2026-05-26.

This is the first status file to read after `AGENTS.md`, `CONTEXT.md`,
`docs/specs/README.md`, and `docs/adr/README.md`. It answers the current state
and points to the smaller ledgers that own detail.

## Snapshot

- `main` and `origin/main` are aligned at
  `fc472ab feat(api): rate-limit legacy admin and public Agent View routes (AP-14) (#85)`.
- `pnpm verify` passed on 2026-05-25 with 72 Turbo tasks.
- Phase 1, the CLI-first MVP, is functionally complete.
- Phase 3, public OAuth + web dashboard + CLI login, is complete.
- `apps/jobs` and `apps/mcp` remain scaffolds, as expected for Phase 4/5.
- `apps/stream`, `packages/billing`, Access Link persistence, bundle state, and
  scanner persistence do not exist yet.
- Known security/ops debt: Cloudflare Access now gates the production operator
  web/API paths, and the hosted API environments now carry the app-side
  `CF_ACCESS_AUD` Wrangler secret. Production service-token/JWT smoke passed for
  `/v1/web/admin/lockdowns` on 2026-05-26, and the approved human browser
  `/admin` check passed after the WorkOS `admin` role assignment. The repo-local
  `ADMIN_TOKEN` `/admin/*` path still exists until AP-12/AP-13 retire it.

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
  jobs queues/cron/DLQs, bundles, pinning, revision retention, and Live Updates.
- Phase 5: OAuth-only MCP transport, auth verification, API forwarding, and MCP
  tools.
- Phase 6: app-layer byte encryption, real safety scanner, stronger audit/abuse
  operations, and tested rotation automation.
- Parked ops/security hardening: optional dedicated admin hostname decision and
  `ADMIN_TOKEN` retirement.
- Post-launch: open-core billing, plan tiers, Stripe sync, billing UI, and jobs
  reconciliation.

See [phase-backlog.md](./status/phase-backlog.md) for implementation order and
[coverage.md](./status/coverage.md) for the spec/ADR ledger.

## Current Implementation Reality

- Implemented: `apex`, `api`, `upload`, `content`, `cli`, most of `web`,
  `contracts`, `worker-runtime`, `db`, `tokens`, `auth`, `api-client`,
  `commands`, `storage`, and repo guardrail packages.
- Scaffolded only: `jobs` and `mcp`.
- Placeholder UI: `web` Access Links.
- Absent: `stream`, `billing`, Access Link tables/routes, jobs queues, bundle
  state, safety-warning storage, app-layer encryption.

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
