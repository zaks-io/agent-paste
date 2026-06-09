# Project Status

Project start: 2026-05-18 (first commit on `main`).

Last updated: 2026-06-08 (public repository flip: repo is public with CodeQL,
secret scanning, Dependabot alerts, OpenSSF Scorecard + badge, and SHA-pinned
Actions live; AP-254 public-repo security posture closed).
See [changelog.md](./status/changelog.md) for what shipped.

This is the first status file to read after `AGENTS.md`, `CONTEXT.md`,
`docs/specs/README.md`, and `docs/adr/README.md`. It answers the current state
and points to the smaller ledgers that own detail.

## Active Handoff

None. No unmerged local handoff branch.

AP-236 (rate-limit fail-closed + production deploy source hardening) shipped in
PR #356 (merge `7113f77`, on `main`) and is Done. Pick up the next item from
[phase-backlog.md](./status/phase-backlog.md), or the early-alpha public
security posture toggles under
[AP-254](https://linear.app/zaks-io/issue/AP-254).

Standing security-posture decisions (still in force, not handoff-specific):
file-bytes malware scanning is an accepted near-term risk, proof-of-work is not
the primary long-term abuse lever, and hard production deploy wait limits are
deferred until enough production usage justifies them. The hosted-content
provenance badge is a separate product/security follow-up in
[AP-235](https://linear.app/zaks-io/issue/AP-235/add-hosted-content-provenance-badge-to-reduce-phishing-risk).

## Early Alpha Hardening

This section tracks post-launch alpha hardening. The hosted service is live;
open items improve production confidence, public repo signals, and security
posture rather than blocking launch. The linked ledgers and Linear tickets own
detail and evidence.

Done for this section: every open item below is checked, or explicitly marked
"not currently required" with evidence in its owner ticket.

1. [ ] **AP-139: Production E2E evidence** (next). Done when the full production
       E2E/smoke sequence has run against the current production deploy and the
       evidence is recorded in AP-139 plus
       [hosted-ops.md](./status/hosted-ops.md).
2. [x] **AP-254: Apex source link**. Done 2026-06-07 (`83cde8c`): the
       `source-repository` component wires the public GitHub link into the apex
       footer/About/How it works, and `apps/apex/src/index.test.ts` asserts the
       `https://github.com/zaks-io/agent-paste` URL in all three. The repo is
       now public (2026-06-08), so the source link resolves.
3. [x] **AP-254: GitHub public security posture**. Done 2026-06-08 with the
       public flip: repo is public, CodeQL (default setup), secret scanning +
       push protection, Dependabot alerts, OpenSSF Scorecard (`3d64126`) + README
       badge (`2de2280`), and SHA-pinned Actions (`33474e4`) are all live.
       Dependabot version updates stay off by design (scheduled review agent).
       Detail in [security-todo.md](./security-todo.md).
4. [ ] **AP-254: OpenSSF Best Practices badge**. Now that the repo is public,
       apply for the **Passing** tier. The two Passing gaps (`release_notes`,
       `test_policy`) are closed; the criterion-by-criterion self-assessment,
       form-answer cribs, and Silver/Gold scope are in
       [openssf-best-practices.md](./openssf-best-practices.md). Done when the
       project is registered, Passing is green, and the README badge is added.
5. [ ] **AP-160: Snyk Code triage**. Done when the Snyk Code entitlement is
       enabled, initial HIGH findings are triaged, narrow ignores are committed
       for confirmed false positives, and the gating/advisory decision is
       recorded.
6. [ ] **AP-235: Hosted-content provenance badge**. Done when hosted content
       visibly distinguishes Agent Paste hosted pages and the behavior is covered
       by docs/tests.
7. [ ] **Conditional: Production Stripe smoke**. Required before enabling paid
       billing publicly. Done when Checkout, webhook activation,
       Portal/invoice access, and plan sync are smoke-tested in production;
       otherwise mark "not currently required" here.
8. [x] **Production deploy of current main**. Done on 2026-06-07: `6ad04f5`
       deployed by manual run `27101054536` with migration, Worker deploy, and
       read-only production smoke green.
9. [x] **npm trusted publishing**. Done on 2026-06-07: operator confirmed npm
       OIDC trusted publishing is already configured for `@zaks-io/agent-paste`.
10. [x] **Minimum public incident intake**. Done on 2026-06-07: `support@agentpaste`
        routes to email and then into Linear.
11. [x] **Hosted Stripe test-mode preview check**. Done on 2026-06-07; production
        Stripe remains conditional above.

## Snapshot

Phases 1–5 are complete: the CLI-first MVP, public OAuth + web dashboard + CLI
login, the Artifact lifecycle (revisions, Access Links, jobs, bundles, Live
Updates), and the MCP surface. The hosted service is live in its early-alpha
shape; current work is post-launch/Phase 6 hardening.
Current `main` (`6ad04f5`) deployed to production successfully on 2026-06-07 via
manual `Deploy Production` run `27101054536`; migration, Worker deploy, and the
read-only production smoke passed.

What stands today:

- **Billing** — Free + Pro is implemented end-to-end behind the deploy-time
  `BILLING_ENABLED` flag (off by default): plan-derived caps, the Stripe
  `BillingProvider` (Checkout, idempotent webhooks, Portal, operator override,
  invoices), the daily reconciliation backstop, and the `/billing`
  dashboard. Enforcement reads only local `workspaces.plan`; Stripe is a sync
  layer, never the hot-path source of truth. Hosted Stripe test-mode was
  verified in preview by Isaac; a final production Stripe smoke is still needed
  only before enabling paid billing publicly.
- **Ephemeral publish** — agent-first self-provision with short-lived low-cap
  keys, daily write allowance, Claim Token promotion, 24h cleanup, `noindex`,
  script-disabled serving, and the post-claim free-to-pro upgrade CTA is
  implemented end-to-end with local + hosted smokes.
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
post-launch/Phase 6 early-alpha hardening: production E2E verification
(AP-139), public-repo security posture (AP-254), Snyk Code triage (AP-160),
hosted-content provenance (AP-235), and security/ops polish.
[phase-backlog.md](./status/phase-backlog.md) owns the ordered remaining work.

## Not Yet Implemented From The Docs

Highest-signal gaps:

- Post-launch/Phase 6 follow-ups: final production E2E verification (AP-139)
  and, before enabling paid billing publicly, a final production Stripe
  smoke. The Stripe Checkout/webhooks/Portal API, operator plan override,
  hosted billing UI, preview/test-mode Stripe verification, and ephemeral
  claim/upgrade funnel have shipped (AP-5/AP-109/AP-176).
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

## Public Repository Status

Repo is **public** (flipped 2026-06-08), licensed **Apache-2.0**, and the ADR
0076 security posture is complete: full-history gitleaks-clean, gating Snyk Open
Source, advisory SAST/SBOM. The public GitHub security features are live —
CodeQL (default setup), secret scanning + push protection, Dependabot alerts,
OpenSSF Scorecard with its README badge, and SHA-pinned Actions. The apex
GitHub source link resolves. Remaining advisory-only items (CodeQL-action SARIF
upload for Trivy/Semgrep, promoting scanners advisory→gating) stay tracked in
[security-todo.md](./security-todo.md) under
[AP-254](https://linear.app/zaks-io/issue/AP-254). Dependabot version updates
stay off by design (dependency bumps come through the scheduled review agent).

A 2026-06-05 external credibility review confirmed most "reputable vendor"
signals already ship (Apache-2.0, `SECURITY.md` private disclosure, GitHub
build-provenance + SBOM on CLI binaries, `npm publish --provenance`, clean npm
metadata). The two doc gaps it surfaced are closed: legal pages now publish the
`Zaks.io, LLC` registered mailing address with a Privacy Contact section, and
the safety docs lead with a "What not to publish" (no secrets/customer data)
warning. AP-254 holds the remaining public-repo/source-link and GitHub security
feature toggles.
On 2026-06-07 Isaac confirmed npm trusted publishing is already configured and
selected a support email alias that routes into Linear as the minimum public
incident intake channel.

Observability is live: all Workers (preview + production + PR previews) emit OTel
traces to Axiom via native Workers Observability (`observability.enabled`), landing
in the `cloudflare` dataset with status, latency, route, and structured app events.

## Parked For Later

- Production deploy gate/wait-timer/vault posture
  ([hosted-ops.md](./status/hosted-ops.md#open-ops-items)).
- Production Stripe smoke when billing is enabled for paid public launch
  (preview/test-mode verification is complete).

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
