# Unit Test Quality Audit

Date: 2026-06-05

Scope: executable Vitest files under `apps/`, `packages/`, and `scripts/`. Test
support files without `it(...)` / `test(...)` were counted separately and not
quality-classified.

## Summary

Static inventory:

- Test/support files found: 257
- Executable test files: 253
- Support-only files: 4
- Static test-case count: 1,758, undercounting `it.each` expansions
- `expect(...)` calls: 4,378
- Mock/spies/fake-timer uses: 1,072

Quality classification after local reconciliation:

| Quality | Files | Meaning                                                                               |
| ------- | ----: | ------------------------------------------------------------------------------------- |
| Good    |   187 | Meaningful behavior, contract, edge, or failure-mode coverage.                        |
| Mixed   |    66 | Keep for now, but weak, over-mocked, too broad, or not enough for hotspot confidence. |
| Bad     |     0 | Known remove-now tests after cleanup.                                                 |

The raw sub-agent classification was 187 good / 57 mixed / 13 bad. I demoted 9
of those "bad" files to mixed after checking them locally because they protect a
real, if thin, contract such as stable query keys, usage-policy formatting, plan
descriptor constants, or static operator copy. The remaining 4 bad tests were
removed after the audit.

## Removed Bad Tests

These were deleted because they gave false confidence or only tested source
shape.

| Deleted file                                           | Why it was bad                                                                                                                                                                                         | Replacement coverage needed                                                                                                                                                       |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/mcp-token.test.ts`                       | Import/wiring check only. It asserted `authenticateMcpBearer` is a function and that `mcpVerifyOptions` maps one option. It did not prove API routes accept or reject MCP member auth.                 | Route-boundary API test using a real signed MCP token on `mcp.whoami` or another `api_key_or_mcp_oauth` route, including forbidden member and bad-audience cases.                 |
| `apps/upload/src/mcp-auth.test.ts`                     | Same import/wiring check as API. It would pass if upload routes stopped accepting MCP member auth.                                                                                                     | Upload worker route test using a real signed MCP token through create/finalize, including forbidden member and bad-audience cases.                                                |
| `scripts/deploy.test.mjs`                              | Read `deploy.mjs` as text and checked declaration ordering. This was source-string trivia, not deploy behavior.                                                                                        | Extract deploy planning/secrets helpers and test missing provider secrets, generated shared values, smoke-forced rotation, stdin-only secret writes, and no secret-value logging. |
| `packages/db/src/repository/postgres-entities.test.ts` | One giant mock-forwarding test. It mocked every query object, forwarded calls, then checked call names and SQL substrings. It could pass while real SQL, RLS, transactions, or mapper semantics broke. | Smaller PGlite-backed tests for raw cleanup SQL plus targeted entity adapter mapper tests.                                                                                        |

## Mixed But Keep

These are weak enough that they should not be counted as strong coverage, but I
would not delete them before replacements exist.

- Web/UI thin render or copy checks: `apps/web/test/ui-primitives.test.tsx`, `BillingDashboard.test.tsx`, `AbuseTriageGuide.test.tsx`, `UsagePolicyCard.test.tsx`.
- Web query/router/meta assembly: `apps/web/test/queries.test.ts`, `router.test.ts`, `routes.test.tsx`, `page-meta.test.ts`, `auth-callback.test.ts`, `chrome.test.tsx`, `BillingHero.test.tsx`, `InvoiceTable.test.tsx`, `RecentArtifacts.test.tsx`, `RecentAudit.test.tsx`, `artifact-status.test.ts`, `command-palette-context.test.tsx`.
- Script config/smoke helpers: `scripts/smoke-mcp-harness.test.mjs`, `smoke-ephemeral-harness.test.mjs`, `smoke-port.test.mjs`, `hosted-job-queues.test.mjs`, `pr-preview-job-queues.test.mjs`, `rotate-versioned-secret.test.mjs`, `rotate-workos-secrets.test.mjs`.
- Jobs call-shape or harness tests: `apps/jobs/src/jobs-coverage.test.ts`, `index.test.ts`, `smoke.test.ts`, `smoke-sync-byte-purge.test.ts`, `db.test.ts`, `lifecycle/bundle-generate-enqueue.test.ts`, `discovery/billing-reconcile.test.ts`, `bundle/generate-zip.test.ts`, `safety/platform-lockdown.test.ts`, `op-log-sentry.test.ts`, `queue.test.ts`.
- Package thin contract tests: `packages/plans/src/index.test.ts`, `packages/brand/src/index.test.ts`, `packages/contracts/src/routes/registry.test.ts`, `jobs.test.ts`, `billing.test.ts`, `liveUpdates.test.ts`, `packages/config/src/index.test.ts`, `packages/storage/src/index.test.ts`, `packages/commands/src/index.test.ts`, `packages/repo-lint/src/upload-workos-wrangler-config.test.mjs`.
- DB/repository mixed tests: `packages/db/src/validation.test.ts`, `queries/index.test.ts`, `index.test.ts`, `repository/web-transforms.test.ts`, `repository/postgres-unit-of-work.test.ts`, `access-link-invalidation.test.ts`, `artifact-invalidation.test.ts`.

## Real Coverage

Post-removal coverage was run and merged:

```text
Statements   : 88.4% (8268/9352)
Branches     : 80.74% (5077/6288)
Functions    : 87.47% (1990/2275)
Lines        : 88.64% (8051/9082)
```

Coverage is not fake overall. The suite has strong behavioral coverage in:

- Tokens, signing, access-link tamper/expiry, upload/content token codecs.
- Content serving security: denylist, MIME, CSP, encrypted R2 reads, rate limit before object reads.
- Jobs queue handlers with PGlite FORCE RLS coverage.
- Billing package sync/reconcile/override workflows.
- API route contracts, error envelopes, idempotent replay paths, and access-link invalidation.
- CLI credentials/keychain/update checks with controlled filesystem/process boundaries.

But the aggregate gate hides these hotspots:

| File                                                              | Fresh coverage                      | Why it matters                                                                                                                      |
| ----------------------------------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `apps/upload/src/finalize.ts`                                     | 0% statements / 0% branches         | Upload finalize is a critical publish path. Current tests hit forbidden/replay behavior before the handler, not the handler itself. |
| `apps/web/src/server/web-loaders.ts`                              | 55.26% statements / 55.88% branches | WorkOS auth/session and dashboard loader behavior are central to authed routes.                                                     |
| `apps/web/src/rpc/web-mutations.ts`                               | 25.53% statements                   | Server mutation RPC wrappers are mostly uncovered.                                                                                  |
| `packages/db/src/local-mvp-sql-executor.ts`                       | 64.54% statements / 59.86% branches | Local harness jobs depend on a large SQL dispatcher.                                                                                |
| `packages/db/src/repository/workflows/access-links-workflow.ts`   | 86.36% statements / 60.87% branches | Access Link lifecycle and lockdown behavior are security-sensitive.                                                                 |
| `packages/db/src/repository/workflows/upload-publish-workflow.ts` | 83.17% statements / 77.78% branches | Core Artifact publish path.                                                                                                         |
| `apps/cli/src/index.ts`                                           | 80% statements / 67.15% branches    | CLI publish/login/logout dispatch is user-facing and has many branches.                                                             |
| `apps/jobs/src/safety/ephemeral-scanner.ts`                       | 83.33% statements / 63.79% branches | Ephemeral publish abuse controls.                                                                                                   |
| `apps/api/src/routes/web.ts`                                      | 88.65% statements / 69.61% branches | Dashboard API surface, billing/settings/keys/access links.                                                                          |
| `apps/api/src/live-updates.ts`                                    | 90.18% statements / 80% branches    | Live Update notification path is tested in slices, not end-to-end.                                                                  |

## Hotspot Gaps

- MCP auth at API/upload boundaries: bad import-only tests should become real route-boundary tests with signed MCP tokens.
- Upload finalize: add direct handler/route coverage for happy path, missing R2, missing session, incomplete upload, idempotency in-flight, and repository error mapping.
- RLS/workspace isolation: jobs has strong FORCE RLS evidence. API/upload routes mostly use mocked DBs or local repositories. Add PGlite route-boundary tests for cross-workspace artifacts, access links, billing rows, and upload sessions.
- Live Updates: API and Stream are tested separately with mocks. Missing publish-to-API notify-to-Stream DO SSE event, including revoke/lockdown disconnect.
- Billing: package coverage is good, app-slice tests are thinner. Missing delayed/reordered Stripe event convergence and billing job reconciliation against realistic snapshots.
- Web WorkOS/session flow: add expired session, missing access token, callback API error, and role-claim matrix coverage against `loadAuthedSession`.
- Dashboard query/mutation safety: query keys are covered, but not enough real QueryClient invalidation/cache-state behavior around mutations.
- Deploy/secret scripts: deploy itself is barely tested compared with its risk. Extract testable units rather than source-string checks.

## Ticket Overlap

Current in-flight tickets cover the biggest aggregate coverage gaps, but not all
replacement coverage from the removed tests.

| Ticket                                        | Covers                                                                                                                   | Does not cover                                                                                                                                                       |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AP-209 upload finalize handler coverage       | `apps/upload/src/finalize.ts` happy path, failure mapping, missing storage/session, incomplete observation, idempotency. | Deleted upload MCP auth import test unless expanded to include signed MCP route-boundary auth through create/finalize.                                               |
| AP-210 web loader/RPC bridge coverage         | `apps/web/src/server/web-loaders.ts`, `apps/web/src/rpc/web-loaders.ts`, `apps/web/src/rpc/web-mutations.ts`.            | React warning cleanup, deploy scripts, MCP auth, Postgres entity adapter behavior, and deeper QueryClient cache invalidation semantics.                              |
| AP-211 local MVP SQL executor branch coverage | `packages/db/src/local-mvp-sql-executor.ts` dispatcher branches.                                                         | Deleted `postgres-entities.test.ts`; that file was about Postgres repository/entity adapter behavior, not the local SQL executor.                                    |
| AP-212 coverage exclusion audit               | Coverage config, excluded worker entrypoints/web routes, and follow-up identification.                                   | Concrete replacement tests for deploy behavior, MCP auth, Postgres entity adapters, RLS route-boundaries, or live updates unless the ticket is explicitly broadened. |
| AP-213 React `act(...)` warning cleanup       | Test harness hygiene for web React tests.                                                                                | Real feature coverage gaps.                                                                                                                                          |

Created follow-up tickets:

- AP-215: API/upload MCP route-boundary auth. Replace the deleted API/upload import tests with signed-token route tests, including bad audience, forbidden member/no membership, and API-key parity.
- AP-216: Deploy behavior tests. Extract testable deploy planning/secrets helpers and test provider-secret validation, generated shared values, smoke-forced rotation, stdin-only secret writes, and no secret logging.
- AP-217: Postgres entity adapter behavior. Replace the deleted mock-forwarding test with PGlite-backed raw cleanup SQL and mapper semantics tests.
- AP-218: Live Updates end-to-end path. Publish through API notification into Stream DO/SSE, including revoke/lockdown disconnect behavior.
- AP-219: RLS route-boundary matrix. Add PGlite-backed API/upload route tests for cross-workspace artifacts, access links, billing rows, and upload sessions.

## Verification

Commands run:

```sh
pnpm test:scripts
pnpm --filter @agent-paste/api test
pnpm --filter @agent-paste/upload test
pnpm --filter @agent-paste/db test
pnpm test:coverage
pnpm verify
```

Results:

- `pnpm test:scripts`: 23 files passed, 123 tests passed.
- `pnpm --filter @agent-paste/api test`: 23 files passed, 249 tests passed.
- `pnpm --filter @agent-paste/upload test`: 5 files passed, 33 tests passed.
- `pnpm --filter @agent-paste/db test`: 40 files passed, 239 tests passed.
- `pnpm test:coverage`: 37/37 tasks successful, with affected packages rerun and
  unaffected packages replayed from Turbo cache.
- Merged coverage passed the project gate at 80.74% branch coverage.
- `pnpm verify`: passed, including docs format, knip, duplicate check, Turbo
  lint/typecheck/test/openapi/db checks, and scripts tests.

## Done

- Unit test inventory completed.
- Sub-agents reviewed worker apps, shared packages/database, and web/CLI/scripts.
- Bad tests removed.
- Mixed weak tests separated from true bad tests.
- Fresh coverage run and hotspot gaps recorded.
- In-flight ticket overlap mapped, with replacement tickets identified.
