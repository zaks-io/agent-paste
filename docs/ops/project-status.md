# Project Status

Last updated: 2026-06-02 (main at AP-111; ephemeral publish runbook AP-112).

This is the first status file to read after `AGENTS.md`, `CONTEXT.md`,
`docs/specs/README.md`, and `docs/adr/README.md`. It answers the current state
and points to the smaller ledgers that own detail.

## Snapshot

- `main` and `origin/main` are aligned at
  `777db63 Add hosted ephemeral publish smoke for preview, PR, and production (#172)`.
- Phase 1, the CLI-first MVP, is functionally complete.
- Phase 3, public OAuth + web dashboard + CLI login, is complete.
- `apps/jobs` has queue/cron/DLQ topology, lifecycle purge/retention, bundle
  zip generation, and built-in safety warning replacement (AP-21/AP-23/AP-33).
- App-layer encryption for Artifact bytes ships in
  `packages/storage/src/artifact-bytes-encryption.ts`. Secret-rotation
  automation (signing/content/pepper/WorkOS, with overlap windows) ships in
  `packages/rotation` + `scripts/rotate-*.mjs` (AP-35); live secret writes stay
  operator-approved per ticket.
- `packages/billing` has plan tiers, the daily reconciliation backstop,
  drift logging, and plan-derived usage caps (AP-4/AP-6); Checkout/webhooks
  remain for AP-5 and stay post-launch. `apps/stream` implements ADR 0069 Live
  Updates (AP-25), and scanner persistence exists in `packages/db`.
- Agent-first ephemeral publish is implemented end-to-end on `main` through
  AP-99/AP-101/AP-102/AP-103/AP-104/AP-105/AP-107/AP-108/AP-110/AP-111: data
  model, Claim Token storage, proof-of-work provision, 24h auto-deletion,
  noindex + script-disabled serving, ephemeral-tier scanner routing, daily write
  allowance, claim/reparent API, CLI `publish --ephemeral`, web `/claim` UX, and
  local + hosted smokes (PR preview workflow included). Remaining product slice:
  claim/upgrade funnel polish (AP-109) and billing upgrade surfaces (AP-5).
  Operators: [`runbook-ephemeral-publish.md`](./runbook-ephemeral-publish.md).
- MCP publish chain mints a durable Revision Link per ADR 0061 and is
  replay-safe for share links (AP-84/AP-88); member/MCP artifact delete now
  runs the content-invalidation boundary (AP-87).
- Signed-token key resolution is consolidated into one rotation seam in
  `packages/rotation/src/signers.ts` (AP-90).
- CI runs a full-history gitleaks secret scan (`.gitleaks.toml`, `Secret scan`
  job). History verified clean on 2026-05-29.
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
- [Complexity todo](./complexity-todo.md) - Biome file/function/complexity
  limits and the ratchet plan toward 300 lines / 60 func-lines / 15 complexity.
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
- [Ephemeral publish runbook](./runbook-ephemeral-publish.md) - provision,
  publish, claim, abuse, support, and smoke verification (AP-112).

## Current Phase

Phase 3 is complete. WorkOS project setup, web AuthKit integration, CLI
login, dashboard data loaders, key lifecycle, audit reads, settings mutation,
operator lockdown APIs, preview/production web deploys, hosted web auth smoke,
and deep-link return paths are implemented. Phase 4 and Phase 5 are complete
for the current Access Link, lifecycle/jobs/bundle, Live Updates, and MCP
surfaces. Current active work is post-launch/Phase 6 hardening around billing
surfaces, ephemeral claim/upgrade, and ops polish.

## Not Yet Implemented From The Docs

Highest-signal gaps:

- Post-launch/Phase 6 follow-ups: Stripe Checkout/webhooks/Portal (AP-5),
  hosted billing UI, operator plan override, and ephemeral claim/upgrade funnel
  polish (AP-109).
- Phase 4 follow-ups: Access Link Lockdown live disconnect hook, operator-tunable viewer cap.
- Parked ops/security hardening: optional dedicated admin hostname decision.

## Publish / open-source gate

The `@zaks-io/agent-paste` CLI is `license: "UNLICENSED"` and intentionally
NOT publishable. `apps/cli/scripts/prepublish-guard.mjs` (wired as
`prepublishOnly`) hard-blocks `npm publish` while unlicensed and also asserts
the bundle is self-contained (no `@agent-paste/*` leak), the only runtime dep
is `@napi-rs/keyring`, and `files` ships exactly `dist` + `README.md`.

To publish later: land the open-core licensing decision (ADR 0073 leans
Apache-2.0), add a real OSI `license` field + `LICENSE` file, then the guard
unblocks. Full git history is gitleaks-clean as of 2026-05-29.

See [phase-backlog.md](./status/phase-backlog.md) for implementation order and
[coverage.md](./status/coverage.md) for the spec/ADR ledger.

## Current Implementation Reality

- Implemented: `apex`, `api`, `upload`, `content`, `cli`, most of `web`, `mcp`,
  `stream`, `contracts`, `worker-runtime`, `db`, `tokens`, `rotation`, `auth`,
  `api-client`, `commands`, `storage`, and repo guardrail packages.
- Implemented: `billing` (plan tiers, reconciliation, drift, plan-derived caps;
  Checkout/webhooks pending AP-5) and app-layer Artifact-bytes encryption in
  `packages/storage`.
- Partial: `jobs` only where future hardening adds new queue families beyond
  the current lifecycle/bundle/safety-scan/billing-reconcile set.
- Scaffolded only: none in the active app set.
- Placeholder UI: dashboard Access Link management.

Full component map:
[implementation.md](./status/implementation.md#components).

## Parked For Later

- Logpush -> Axiom wiring remains documented in
  [runbook-logpush.md](./runbook-logpush.md).
- Production deploy gate/wait-timer/vault posture remains parked in
  [hosted-ops.md](./status/hosted-ops.md#open-ops-items).
- Stripe Checkout + webhooks (AP-5, ADRs 0073/0074) are intentionally
  post-launch; the local source of truth, `BillingProvider` seam, and
  reconciliation backstop already exist.
- Ephemeral publish code and smokes are on `main`; treat a specific environment
  as live only after its hosted ephemeral smoke passes (see
  `runbook-ephemeral-publish.md`). AP-109 claim/upgrade funnel polish remains.

## Maintenance Rules

- Keep this file short and current.
- Move historical completion detail to [changelog.md](./status/changelog.md).
- Move active and future implementation detail to
  [phase-backlog.md](./status/phase-backlog.md).
- Update [coverage.md](./status/coverage.md) when ADR/spec status changes.
- Update [implementation.md](./status/implementation.md) when an app/package
  changes state.
