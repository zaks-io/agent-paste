# Phase Backlog

Last updated: 2026-05-25. Source of truth for the ordered remaining work.
When asked to "implement the next step", start at the first unchecked item in
the active phase below unless the user says otherwise.

## Current Position

Phase 1 is complete for the hosted CLI-first MVP. Phase 3 is the active product
phase. The WorkOS dashboard, CLI login, web deploys, and dashboard API tranches
are already implemented. Phase 3 is now close-out and operator-surface work, not
initial OAuth/dashboard bring-up.

Access Links are not Phase 3. They start in Phase 4 because they depend on
multi-revision artifacts and the Access Link signing-key family.

## Active: Phase 3 Close-Out

Goal: self-serve browser signup/login, dashboard use, CLI login, and operator
admin basics.

1. [x] Fix the transient first authenticated dashboard load race.
       `POST /v1/auth/web/callback` provisions the member, but parallel
       `/v1/web/*` loaders can run before the commit is visible and return
       `forbidden` until reload. Fixed by moving `_authed` provisioning into
       `beforeLoad`, so the callback commits before child loaders run.
2. [x] Build the operator lockdown UI. The web `/admin` route now lists active
       lockdowns and lets operators set or lift workspace/artifact lockdowns
       through the existing operator API.
3. [ ] Harden PR-preview readiness. Require `curl --fail` against `/healthz`,
       require consecutive successes, retry known 1042/404 propagation flakes,
       and add a docs-only path filter so documentation PRs skip per-PR deploy.
4. [ ] Add the Lighthouse a11y gate on `/dashboard` empty state and fail the
       preview job below 95.
5. [ ] Write `docs/ops/runbook-workos.md`: WorkOS project config, redirect URI
       drift, API-key/cookie rotation, and common auth failures.
6. [ ] Promote status after the above lands: update ADR 0033/0059/0068
       coverage and the Phase 3 summary in `project-status.md`.
7. [ ] Restore deep-link return paths for unauthenticated `_authed` redirects.
       This was dropped because query strings in thrown redirects trigger a
       TanStack Router SSR coercion bug.

Nice-to-have but not a Phase 3 gate:

- [ ] Cmd-K command palette.
- [ ] Per-route document titles and OG metadata.
- [ ] Storybook/Ladle only if component review starts paying for itself.

## Parked Ops / Phase 2

Goal: operational depth without changing the product surface.

1. [ ] Logpush -> Axiom wiring per `docs/ops/runbook-logpush.md`.
2. [ ] Tested multi-key and multi-pepper rotation automation for ADR 0045.
3. [ ] Richer event/audit browsing for operators.
4. [ ] GitHub Production environment reviewer/wait-timer/admin-bypass posture.
5. [ ] Neon hardening: separate Hyperdrive runtime role from migration role,
       and restrict migration URL secrets to migration workflows.

## Phase 4: Artifact Lifecycle, Access Links, Jobs, Bundles

Goal: move from one-shot publishes to managed artifacts with revisions, links,
background jobs, and generated bundles.

Recommended order:

1. [ ] Multi-revision artifact model and publish-update flow.
       This unlocks revision-pinned links, latest-moving links, retention of old
       revisions, bundle generation, and Live Updates.
2. [ ] Access Link data model and signed URL codec.
       Add `access_links`, fragment payload signing with `kid`, mint/re-mint,
       revoke, row expiration, and Access Link Lockdown state.
3. [ ] Access Link resolve API and viewer.
       Implement `POST /v1/access-links/resolve`, wire `/al/{publicId}` to the
       API, enforce generic not-found failures, and keep the no-auth/no-analytics
       lint boundary.
4. [ ] Jobs worker queue topology.
       Implement cron discovery and Cloudflare Queue consumers for `byte-purge`,
       `safety-scan`, and `bundle-generate`; add DLQs according to ADR 0032,
       0049, and 0050.
5. [ ] Move lifecycle byte purge and retention work out of `api` scheduled
       cleanup as the jobs worker becomes authoritative.
6. [ ] Bundle generation and download.
       Add bundle status fields, deterministic R2 bundle keys, bundle size caps,
       Agent View bundle state, and the bundle-generate DLQ consumer.
7. [ ] Pinning and revision retention.
       Add pinned artifacts, non-current revision retention, and auto-deletion
       behavior that respects pinning.
8. [ ] Live Updates after dependencies are ready.
       Follow `docs/ops/live-updates-todo.md`: add `apps/stream`, per-artifact
       Durable Objects, SSE over `fetch()`, publish notification, viewer caps,
       and proactive disconnect on takedown.

## Phase 5: MCP

Goal: hosted agents can publish and inspect artifacts without shelling out to
the CLI.

Recommended order:

1. [ ] Re-decide the OAuth provider before implementation. ADR 0061 still says
       Auth0 DCR; current project direction expects WorkOS-compatible auth.
2. [ ] Define MCP contracts in `packages/contracts` for tool schemas, auth
       requirements, error mapping, and forwarded API calls.
3. [ ] Implement Streamable HTTP MCP transport on `apps/mcp`: JSON-RPC over
       `POST /`, optional SSE responses, stateless request auth, and correct
       `WWW-Authenticate` challenges.
4. [ ] Verify OAuth tokens and forward to `api` over a service binding. API keys
       must not authenticate to MCP.
5. [ ] Implement the initial tool surface from ADR 0061: text-only publish,
       add revision, list/read artifacts, list revisions, delete/update
       metadata, Access Link create/list/revoke, and `whoami`.
6. [ ] Add MCP hosted smoke and host onboarding docs.

## Phase 6: Platform Hardening

Goal: security, abuse, and enterprise-shaped controls once the core product has
usage.

1. [ ] Application-layer encryption for artifact bytes.
2. [ ] Real safety scanner integration behind the scanner interface.
3. [ ] Stronger audit semantics and operator abuse workflows.
4. [ ] Automated signing-key, content-key, API-pepper, and WorkOS rotation with
       overlap windows.
5. [ ] Public SDK and standalone CLI binaries only if product demand warrants
       them.

## Post-Launch / Billing

Goal: hosted-service monetization without making self-hosters configure Stripe.

1. [ ] Add `workspaces.plan` and plan-resolved usage policy values behind a
       deploy-time billing flag that is off by default.
2. [ ] Create severable `packages/billing` with a `BillingProvider` seam and a
       no-op adapter.
3. [ ] Add Stripe Checkout, synchronous activation, idempotent webhooks, and
       Customer Portal routes mounted in `api` only when billing is enabled.
4. [ ] Add `workspace_billing` and daily jobs reconciliation so local
       entitlements converge even if webhooks are delayed or disabled.
5. [ ] Add hosted web billing UI and operator plan override.

## Codebase Follow-Ups

These are not phase gates, but they are documented cleanup:

- [ ] `LocalUnitOfWork` in-flight idempotency tracking and `peekReplay`
      faithfulness.
- [ ] Decide whether `deleted_r2_objects` is replay-stable or best-effort.
- [ ] Split `RepositoryCore` if growth continues, without reintroducing backend
      orchestration duplication.
- [ ] Automate SDK regeneration if public SDK work becomes real.
