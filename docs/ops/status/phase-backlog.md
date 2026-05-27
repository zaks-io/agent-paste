# Phase Backlog

Last updated: 2026-05-27 (AP-24 pinning and non-current revision retention).
remaining work. When asked to "implement the next step", start at the first
unchecked item in the active phase below unless the user says otherwise.

## Current Position

Phase 1 is complete for the hosted CLI-first MVP. Phase 3 is the active product
phase. The WorkOS dashboard, CLI login, web deploys, and dashboard API tranches
are already implemented. Phase 3 is now close-out and operator-surface work, not
initial OAuth/dashboard bring-up.

Access Links are not Phase 3. They start in Phase 4 because they depend on
multi-revision artifacts and the Access Link signing-key family.

Security/ops debt remains parked below: Cloudflare Access now gates the
production operator web/API paths, and the hosted API environments now carry the
app-side `CF_ACCESS_AUD` Wrangler secret. Production service-token/JWT smoke and
the human browser `/admin` check both passed on 2026-05-26. The legacy `ADMIN_TOKEN` `/admin/*` path was retired in AP-13.
Richer operator event/audit browsing shipped in AP-16, with the follow-up
coverage gate restored in PR #92.

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
3. [x] Harden PR-preview readiness. The preview gate now polls `/healthz` on
       every deployed worker (api/upload/content/apex/web each serve an
       unauthenticated 200), requires 3 consecutive 200s, treats 404/530 (CF 1042) as transient propagation flakes and retries, and the workflow
       skips docs-only PRs via `paths-ignore`.
4. [x] Add the Lighthouse a11y gate on `/dashboard` empty state and fail the
       preview job below 95. `scripts/lighthouse-dashboard-a11y.mjs` runs a
       local mock-WorkOS harness, audits authenticated dashboard empty chrome
       via Lighthouse accessibility-only, and `pr-preview.yml` fails below 95.
5. [x] Write `docs/ops/runbook-workos.md`: WorkOS project config, redirect URI
       drift, API-key/cookie rotation, and common auth failures.
6. [x] Promote status after the above lands: update ADR 0033/0059/0068
       coverage and the Phase 3 summary in `project-status.md`.
7. [x] Restore deep-link return paths for unauthenticated `_authed` redirects.
       `_authed.beforeLoad` now redirects through
       `/api/auth/sign-in/p/{base64url(pathname)}` so returnPathname survives
       without a query string on the thrown redirect href.

Nice-to-have but not a Phase 3 gate:

- [x] Cmd-K command palette.
- [x] Per-route document titles and OG metadata.
- [ ] Storybook/Ladle only if component review starts paying for itself.

## Parked Ops / Phase 2

Goal: operational depth without changing the product surface.

1. [ ] Logpush -> Axiom wiring per `docs/ops/runbook-logpush.md`.
2. [x] Finish Cloudflare Access app-side follow-up for production operator
       paths. The Access app/policy exists and gates `/admin` on
       `app.agent-paste.sh` plus `/v1/web/admin/lockdowns` on
       `api.agent-paste.sh`; `CF_ACCESS_AUD` is set as a Wrangler secret on the
       hosted API Workers. Production service-token/JWT smoke passed for the API
       lockdown list on 2026-05-26, and the approved human browser `/admin`
       check passed after assigning the WorkOS `admin` role.
3. [ ] Decide whether to add a dedicated admin/operator hostname.
       No new CNAME is needed for the current path-based Access gate; add and
       document one only if the operator surface grows enough to justify it.
4. [x] Retire the repo-local `ADMIN_TOKEN` `/admin/*` path after Cloudflare
       Access + WorkOS operator routes cover the remaining operational needs
       (AP-13).
5. [x] Execute the legacy admin migration plan (AP-12/AP-13): removed `/admin/*`
       contracts, API routes, CLI admin verbs, and `ADMIN_TOKEN` secrets;
       smokes use WorkOS/CLI login or `SMOKE_HARNESS_SECRET` harness routes.
6. [x] Add rate limiting to legacy admin-token routes and public bearer read
       surfaces that currently lack explicit limits, especially `/admin/*` and
       public Agent View.
7. [x] Tested multi-key and multi-pepper rotation automation for ADR 0045.
8. [x] Richer event/audit browsing for operators.
9. [ ] GitHub Production environment reviewer/wait-timer/admin-bypass posture.
10. [x] Neon hardening: separate Hyperdrive runtime role from migration role,
        and restrict migration URL secrets to migration workflows (AP-18; operator
        Hyperdrive + GitHub secret cutover tracked in
        [`runbook-neon-database-roles.md`](../runbook-neon-database-roles.md)).

## Phase 4: Artifact Lifecycle, Access Links, Jobs, Bundles

Goal: move from one-shot publishes to managed artifacts with revisions, links,
background jobs, and generated bundles.

Recommended order:

1. [x] Multi-revision artifact model and publish-update flow.
       This unlocks revision-pinned links, latest-moving links, retention of old
       revisions, bundle generation, and Live Updates.
2. [x] Access Link data model and signed URL codec.
       Add `access_links`, fragment payload signing with `kid`, mint/re-mint,
       revoke, row expiration, and Access Link Lockdown state.
3. [x] Access Link resolve API and viewer.
       Implement `POST /v1/access-links/resolve`, wire `/al/{publicId}` to the
       API, enforce generic not-found failures, and keep the no-auth/no-analytics
       lint boundary.
4. [x] Jobs worker queue topology.
       Implement cron discovery and Cloudflare Queue consumers for `byte-purge`,
       `safety-scan`, and `bundle-generate`; add DLQs according to ADR 0032,
       0049, and 0050.
5. [x] Move lifecycle byte purge and retention work out of `api` scheduled
       cleanup as the jobs worker becomes authoritative.
6. [x] Bundle generation and download.
       Add bundle status fields, deterministic R2 bundle keys, bundle size caps,
       and Agent View bundle state.
7. [x] Pinning and revision retention.
       Add pinned artifacts, non-current revision retention, and auto-deletion
       behavior that respects pinning.
8. [x] Live Updates after dependencies are ready.
       Follow `docs/ops/live-updates-todo.md`: `apps/stream`, per-artifact
       Durable Objects, SSE over `fetch()`, publish notification, viewer caps,
       and proactive disconnect on takedown (AP-25).

## Phase 5: MCP

Goal: hosted agents can publish and inspect artifacts without shelling out to
the CLI.

Recommended order:

1. [x] Re-decide the OAuth provider before implementation. ADR 0061 now records
       WorkOS AuthKit/Connect for MCP OAuth, with CIMD primary and DCR enabled
       for compatibility.
2. [x] Define MCP contracts in `packages/contracts` for tool schemas, auth
       requirements, error mapping, and forwarded API calls.
3. [x] Implement Streamable HTTP MCP transport on `apps/mcp`: JSON-RPC over
       `POST /`, optional SSE responses, stateless request auth, and correct
       `WWW-Authenticate` challenges.
4. [x] Verify OAuth tokens and forward to `api` over a service binding. API keys
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

- [x] `LocalUnitOfWork` in-flight idempotency tracking and `peekReplay`
      faithfulness.
- [ ] Deepen the Upload Session lifecycle module when Phase 4 publish/update
      work starts.
- [ ] Decide whether `deleted_r2_objects` is replay-stable or best-effort.
- [x] Deepen deletion/invalidation side effects once jobs own lifecycle byte
      purge (AP-40).
- [ ] Split `RepositoryCore` if growth continues, without reintroducing backend
      orchestration duplication.
- [ ] Automate SDK regeneration if public SDK work becomes real.
