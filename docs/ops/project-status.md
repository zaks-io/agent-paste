# Project Status

Project start: 2026-05-18 (first commit on `main`).

Last updated: 2026-06-05. See [changelog.md](./status/changelog.md) for what shipped.

This is the first status file to read after `AGENTS.md`, `CONTEXT.md`,
`docs/specs/README.md`, and `docs/adr/README.md`. It answers the current state
and points to the smaller ledgers that own detail.

## Snapshot

Phases 1–5 are complete: the CLI-first MVP, public OAuth + web dashboard + CLI
login, the Artifact lifecycle (revisions, Access Links, jobs, bundles, Live
Updates), and the MCP surface. The hosted service is feature-complete for its
launch shape; current work is post-launch/Phase 6 hardening.

What stands today:

- **Billing** — Free + Pro is implemented end-to-end behind the deploy-time
  `BILLING_ENABLED` flag (off by default): plan-derived caps, the Stripe
  `BillingProvider` (Checkout, idempotent webhooks, Portal, operator override,
  invoices), the daily reconciliation backstop, and the `/settings/billing`
  dashboard. Enforcement reads only local `workspaces.plan`; Stripe is a sync
  layer, never the hot-path source of truth. Remaining: hosted Stripe test-mode
  verification (needs credentials + approval).
- **Ephemeral publish** — agent-first self-provision behind proof-of-work, daily
  write allowance, Claim Token promotion, ephemeral-tier scanning, and
  script-disabled serving are implemented end-to-end with local + hosted smokes.
  Operators: [`runbook-ephemeral-publish.md`](./runbook-ephemeral-publish.md).
- **Dashboard** — Access Link management (list/create/mint/revoke/lockdown) and a
  TanStack Query cache with an SSE-driven live UI are implemented.
- **CLI** — shipped via npm (`@zaks-io/agent-paste`) and standalone signed
  binaries for linux-x64/arm64, macos-arm64, and windows-x64 (SBOM + Sigstore
  provenance), with `agent-paste upgrade` self-update (ADR 0080).
- **Security/ops** — app-layer Artifact-bytes encryption, automated secret
  rotation with overlap windows (live writes operator-approved per ticket),
  Cloudflare Access gating the production operator paths, and split secret
  scanning (fast PR-range gitleaks in CI, full-history in the `Security`
  workflow). The legacy `ADMIN_TOKEN` `/admin/*` path is retired; operator work
  runs through WorkOS + `/v1/web/admin/*`.

Open follow-ups live in the ledgers below. Recent dated changes are in the
[changelog](./status/changelog.md).

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
- [Web CSP todo](./web-csp-todo.md) - dashboard + apex CSP hardening (script-src is
  nonce-based, browser-verified on preview; one item open: drop style `'unsafe-inline'`).
- [Live Updates todo](./live-updates-todo.md) - ADR 0069, shipped (AP-25 backend
  plus AP-164 live UI); two deferred-polish items tracked in AP-166.
- [Repository todo](./repository-todo.md) - repository-core follow-ups.
- [Complexity todo](./complexity-todo.md) - Biome file/function/complexity
  limits and the ratchet plan toward 300 lines / 60 func-lines / 15 complexity.
- [Duplication todo](./duplication-todo.md) - jscpd copy-paste gate (shipped
  code only) and the ratchet plan from 2.7% toward 1.5%.
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
- [Logpush runbook](./runbook-logpush.md) - superseded by native Workers OTel ->
  Axiom export, which is live; retained only if per-Worker Logpush datasets are
  ever wanted.
- [Ephemeral publish runbook](./runbook-ephemeral-publish.md) - provision,
  publish, claim, abuse, support, and smoke verification (AP-112).
- [CLI release runbook](./runbook-cli-release.md) - bump, build signed binaries,
  publish npm, and advertise the new version (ADR 0080).

## Current Phase

Phases 1–5 are complete (see Snapshot). Current active work is
post-launch/Phase 6 hardening: hosted Stripe verification, the ephemeral
claim/upgrade funnel (AP-109), and security/ops polish.
[phase-backlog.md](./status/phase-backlog.md) owns the ordered remaining work.

## Not Yet Implemented From The Docs

Highest-signal gaps:

- Post-launch/Phase 6 follow-ups: hosted Stripe test-mode verification (needs
  credentials + approval) and ephemeral claim/upgrade funnel polish (AP-109).
  The Stripe Checkout/webhooks/Portal API, operator plan override, and hosted
  billing UI all shipped (AP-5/AP-176).
- Live Updates deferred polish (AP-166): Access Link Lockdown live disconnect
  hook, operator-tunable viewer cap. The feature itself is shipped (AP-25 +
  AP-164).
- File-bytes hash-reputation malware scanner: cancelled (AP-149) — too expensive
  to operate for the value now. Containment (script-disabled ephemeral serving,
  locked CSP on the Content Origin, 24h auto-deletion + noindex) already bounds
  the distribution risk; the text/semantic + URL scanners stay in place.
- Security triage backlog: triage Snyk Code (SAST) HIGH findings and enable the
  org SAST entitlement (AP-160); Snyk Code stays advisory until then.

## Open-source gate

Repo is licensed **Apache-2.0** and the ADR 0076 private-phase security posture
is complete (full-history gitleaks-clean, gating Snyk Open Source, advisory
SAST/SBOM). Go-public steps (flip visibility, CodeQL/secret-scanning/Dependabot/
Scorecard, npm trusted publishing) are tracked in
[security-todo.md](./security-todo.md).

Observability is live: all Workers (preview + production + PR previews) emit OTel
traces to Axiom via native Workers Observability (`observability.enabled`), landing
in the `cloudflare` dataset with status, latency, route, and structured app events.

## Parked For Later

- Production deploy gate/wait-timer/vault posture
  ([hosted-ops.md](./status/hosted-ops.md#open-ops-items)).
- Hosted Stripe test-mode verification (billing code ships; needs credentials).

(Ephemeral smoke is built and runs in CI: `smoke:preview:ephemeral` /
`smoke:production:ephemeral` / `smoke:pr:ephemeral`. Running it against an env
before declaring that env live is operational procedure, not parked work — see
[runbook-ephemeral-publish.md](./runbook-ephemeral-publish.md).)

## Maintenance Rules

Keep this file a short orientation snapshot. Push detail down to the ledgers:
dated changes to [changelog.md](./status/changelog.md), remaining work to
[phase-backlog.md](./status/phase-backlog.md), the component map to
[implementation.md](./status/implementation.md), and spec/ADR status to
[coverage.md](./status/coverage.md).
