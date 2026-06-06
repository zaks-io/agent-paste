# Project Status

Project start: 2026-05-18 (first commit on `main`).

Last updated: 2026-06-05 (open-source-gate refresh: legal address + secrets
guidance shipped in PR #393, launch-readiness gaps aggregated under AP-254).
See [changelog.md](./status/changelog.md) for what shipped.

This is the first status file to read after `AGENTS.md`, `CONTEXT.md`,
`docs/specs/README.md`, and `docs/adr/README.md`. It answers the current state
and points to the smaller ledgers that own detail.

## Active Handoff

Unmerged local branch:
`codex/ap-236-fail-closed-rate-limit-deploy-hardening`.

Tracking ticket:
[AP-236](https://linear.app/zaks-io/issue/AP-236/fail-closed-on-rate-limit-binding-failures-and-harden-production).

Current working tree state:

- Rate-limit bindings now fail closed for actor, workspace, artifact, and
  ephemeral provision paths when bindings are missing or throw.
- Existing public error contracts are preserved where practical:
  `rate_limited_actor`, `rate_limited_workspace`, `rate_limited_artifact`, and
  `ephemeral_provision_unavailable`.
- API/upload/content/local MVP tests and `scripts/local-mvp-server.mjs` now
  configure explicit allow-limit bindings instead of relying on absent bindings
  as an allow path.
- `.github/workflows/deploy-production.yml` now validates `workflow_run` source
  (`success`, `main`, same repository), checks out `refs/heads/main`, verifies
  that checkout matches the CI head SHA, and scopes Turbo/Cloudflare secrets to
  the steps that need them.
- Hosted-content provenance badge is intentionally separate and tracked in
  [AP-235](https://linear.app/zaks-io/issue/AP-235/add-hosted-content-provenance-badge-to-reduce-phishing-risk).

Verification already run on this working tree before `main` advanced:

- `pnpm --filter @agent-paste/worker-runtime check`
- `pnpm --filter @agent-paste/api --filter @agent-paste/upload --filter @agent-paste/content test`
- `pnpm --filter @agent-paste/api --filter @agent-paste/upload --filter @agent-paste/content typecheck`
- `pnpm --filter @agent-paste/worker-runtime --filter @agent-paste/api --filter @agent-paste/upload --filter @agent-paste/content lint`
- `git diff --check`
- Targeted Semgrep on `.github/workflows/deploy-production.yml`

Next agent should not redo the security audit from scratch. Resume by checking
whether `origin/main` has moved beyond `e0eabfb`, rerunning the full repo gate
(`pnpm verify` per workflow config), finishing `ziw-code-review`, then using
`ziw-pr` to commit and open the ready-for-review PR for AP-236. Local review had
started but was interrupted before a final review report was produced.

Security decisions already recorded in the handoff context: file-bytes malware
scanning is an accepted near-term risk, proof-of-work is not the primary
long-term abuse lever, hard production deploy wait limits are deferred until
launch/users, and the hosted provenance badge is a product/security follow-up
instead of part of AP-236.

## Snapshot

Phases 1–5 are complete: the CLI-first MVP, public OAuth + web dashboard + CLI
login, the Artifact lifecycle (revisions, Access Links, jobs, bundles, Live
Updates), and the MCP surface. The hosted service is feature-complete for its
launch shape; current work is post-launch/Phase 6 hardening.

What stands today:

- **Billing** — Free + Pro is implemented end-to-end behind the deploy-time
  `BILLING_ENABLED` flag (off by default): plan-derived caps, the Stripe
  `BillingProvider` (Checkout, idempotent webhooks, Portal, operator override,
  invoices), the daily reconciliation backstop, and the `/billing`
  dashboard. Enforcement reads only local `workspaces.plan`; Stripe is a sync
  layer, never the hot-path source of truth. Remaining: hosted Stripe test-mode
  verification (needs credentials + approval).
- **Ephemeral publish** — agent-first self-provision with short-lived low-cap
  keys, daily write allowance, Claim Token promotion, 24h cleanup, `noindex`,
  and script-disabled serving is implemented end-to-end with local + hosted
  smokes.
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
  runs through WorkOS + `/v1/web/admin/*`. A shared baseline of HTTP security
  headers ships across all eight Workers, and the two public HTML surfaces
  (dashboard, apex) enforce a strict per-request-nonce CSP with no script
  `'unsafe-inline'` (AP-184); one CSP follow-up (style `'unsafe-inline'`) is
  open in [`web-csp-todo.md`](./web-csp-todo.md).

A post-launch hardening wave then closed correctness/security gaps surfaced by
review — Access Link denylist completeness (AP-186), upload finalize and
malformed-escape guards (AP-187/AP-190), jobs RLS scoping under `app_role`, a
bounded auth L1 cache, MCP idempotency-key overflow, and CLI keyring/config-dir
fixes. Open follow-ups live in the ledgers below; recent dated changes are in
the [changelog](./status/changelog.md).

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
  limits (now 510 file-lines / 97 func-lines / 30 complexity) and the ratchet
  plan toward 300 lines / 60 func-lines / 15 complexity.
- [Duplication todo](./duplication-todo.md) - jscpd copy-paste gate (shipped
  code only), now at 2.0% and the ratchet plan toward 1.5%.
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
- File-bytes hash-reputation malware scanner: cancelled/removed. Llama Guard
  and Cloudflare URL Scanner still support the ephemeral advisory/abuse path
  when configured, alongside built-in warning metadata. Containment is the trust
  model: script-disabled ephemeral serving, locked CSP on the Content Origin,
  24h auto-deletion, `noindex`, signed access, revocation, and lockdown.
- Security triage backlog: triage Snyk Code (SAST) HIGH findings and enable the
  org SAST entitlement (AP-160); Snyk Code stays advisory until then.

## Open-source gate

Repo is licensed **Apache-2.0** and the ADR 0076 private-phase security posture
is complete (full-history gitleaks-clean, gating Snyk Open Source, advisory
SAST/SBOM). Go-public steps (flip visibility, the apex GitHub source-link flip,
CodeQL/secret-scanning/Dependabot/Scorecard, npm trusted publishing, status
page) are tracked in [security-todo.md](./security-todo.md) and aggregated under
[AP-254](https://linear.app/zaks-io/issue/AP-254/launch-readiness-close-external-credibility-review-gaps-repo-flip-apex).

A 2026-06-05 external credibility review confirmed most "reputable vendor"
signals already ship (Apache-2.0, `SECURITY.md` private disclosure, GitHub
build-provenance + SBOM on CLI binaries, `npm publish --provenance`, clean npm
metadata). The two doc gaps it surfaced are closed: legal pages now publish the
`Zaks.io, LLC` registered mailing address with a Privacy Contact section, and
the safety docs lead with a "What not to publish" (no secrets/customer data)
warning. AP-254 holds the remaining GitHub/npm-side toggles and the status page.

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
