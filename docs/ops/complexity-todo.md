# Code complexity limits: ratchet plan

Source of truth for the Biome complexity/size gates and the offenders that are
currently suppressed. Owner: Isaac. Snapshot date: 2026-06-05.

Biome 2.4.x enforces three rules in `biome.json` (part of `pnpm lint` ->
`biome lint .`). Tests are exempt via an override
(`**/*.test.*`, `**/*.spec.*`, `**/test/**`, `**/__tests__/**`) because they
legitimately run long.

| Rule                             | Group      | Current limit                | Ratchet target                              |
| -------------------------------- | ---------- | ---------------------------- | ------------------------------------------- |
| `noExcessiveLinesPerFile`        | nursery    | 510 lines (`skipBlankLines`) | 300 (matches the repo file-size convention) |
| `noExcessiveLinesPerFunction`    | complexity | 97 lines (`skipBlankLines`)  | 60                                          |
| `noExcessiveCognitiveComplexity` | complexity | 30                           | 15 (Biome default)                          |

The file-line limit ratcheted 600 -> 510 on 2026-06-05 with no refactor: nothing
in non-test source exceeds 506 lines (`scripts/local-mvp-server.mjs`), so 510 was
free headroom. The function-line limit ratcheted 100 -> 97 on 2026-06-05: AP-231
split `scripts/lib/versioned-secret-rotation.mjs` (its `executeStep` was the old
100-line wall), so the new wall is 96 lines
(`packages/contracts/src/openapi/api.web-admin.ts`) and 97 was free headroom. The
cognitive-complexity (30) limit is still pinned to its wall — an unsuppressed
function sits at exactly 30 cognitive
(`packages/repo-lint/src/monorepo-policy.mjs`) — so it cannot drop without a
refactor.

The limits were set to the tightest values that are **green today without a wave
of refactors**, with the known offenders below carrying inline
`// biome-ignore` suppressions that link back to this file. As offenders get
cleaned up, lower the limits in `biome.json` toward the ratchet targets and drop
the matching suppression.

## Baseline distribution (non-test source, 2026-06-02)

Measured by Biome's own counters (`skipBlankLines: true`):

- Lines per file: p50 58, p90 212, p95 301, p99 419, max 584.
- Lines per function: p50 7, p90 24, p95 36, p99 79, max 360.
- Cognitive complexity: p50 4, p90 10, p95 14, p99 27, max 102.

## Suppressed offenders

Inline suppressions staged ahead of the cognitive-complexity ratchet to 15.
Each is below the snapshot limit of 30 (so Biome reports the suppression as
"unused" at warn level today) but will activate once `biome.json` drops to 15.

### Cognitive complexity (> 15, suppressed for the ratchet to 15)

These are clean, linear flows (flag parsers, char scanners, paginated walks,
fixed step sequences) where the branch count is inherent and splitting them adds
indirection without clarity. Each carries an inline `biome-ignore` linking here.

- `apps/cli/src/index.ts` — `parseArgs`: inherent linear flag-parsing loop; each
  branch is a flat arg case and splitting it hides the parser.
- `scripts/setup-worktree.mjs` — `parseArgs`: same flat flag-parsing loop shape.
- `scripts/lib/hyperdrive-branch-guard.mjs` — `stripJsonComments`: char-by-char
  JSON-comment-stripping state machine; the branches are the states and
  splitting them obscures the scanner.
- `apps/mcp/src/publish-chain.ts` — publish chain: linear sequence of
  independent `.ok`-checked publish steps; splitting adds indirection.
- `packages/billing/src/provider.ts` — Stripe pagination loop: linear cursor
  walk boilerplate; splitting the walk adds no value.

### Cognitive complexity (> 30)

None today.

### Lines per function (> 97)

None today. The wall is 96 (`packages/contracts/src/openapi/api.web-admin.ts`).

### Lines per file (> 510)

None today (limit is 510 as of 2026-06-05). The next file-line wall is
`scripts/local-mvp-server.mjs` at 506 Biome-counted nonblank lines, then
`packages/db/src/schema.ts` (432) and `packages/db/src/repository/interface.ts`
(407). To ratchet below ~508, split the local MVP server (extract its route/handler
tables) first; the contract/OpenAPI registries are already under 510 after AP-225.

## Recently cleaned

- [x] `packages/contracts/src/openapi/api.ts` — `buildApiOpenApiDocument`: AP-225 split
      OpenAPI path registration into resource-group modules (`api.actor.ts`,
      `api.public.ts`, `api.ephemeral.ts`, `api.web.ts`, `api.web-admin.ts`,
      `api.artifacts.ts`, `api.billing.ts`) and removed the function-length
      suppression.
- [x] `packages/db/src/local-mvp-sql-executor.ts`: AP-226 split the monolithic SQL
      branch table into focused statement handlers under
      `packages/db/src/local-mvp-sql-executor/` and removed the cognitive-complexity
      and function-length suppressions from the executor factory and dispatcher.
- [x] `packages/db/src/repository/local-entities/artifacts.ts` and
      `packages/db/src/repository/postgres-entities.ts`: AP-228 split local
      artifact methods and postgres entity adapters into focused domain modules
      (`artifacts-*.ts`, `postgres-entities/*.ts`) and removed the function-length
      and `reparentWorkspace` cognitive-complexity suppressions.
- [x] `packages/rotation/src/automation.ts` and `scripts/lib/versioned-secret-rotation.mjs`:
      AP-231 split versioned-secret rotation plan builders into step helpers
      (`rotation-plan-steps.ts`, `versioned-secret-rotation-format.mjs`,
      `versioned-secret-rotation-execute.mjs`) and removed cognitive-complexity /
      function-length suppressions from the touched rotation tooling.
- [x] `apps/jobs/src/handlers/bundle-generate.ts` and `safety-scan.ts`: AP-232 split
      queue batch handlers into orchestration helpers (`bundle-generate-orchestration.ts`,
      `safety-scan-orchestration.ts`, `safety-scan-files.ts`, `safety-warning-storage.ts`,
      `safety-ephemeral-url-scan.ts`) and refactored `apps/jobs/src/safety/url-scanner.ts`
      submit/poll helpers. Touched functions now pass the 15 cognitive / 60 function-line
      ratchet targets without suppressions.
- [x] `apps/api/src/routes/revisions.ts` — `publishRevision` idempotent body:
      AP-142 moved publish orchestration into a Publish Coordinator and removed
      the cognitive-complexity suppression. The route and coordinator pass the
      final 15 cognitive / 60 function-line / 300 file-line targets.
- [x] `packages/worker-runtime/src/registrar.ts` route handling: AP-233 moved
      guard orchestration into `registrar-pipeline.ts` and request helpers into
      `registrar-request.ts`, removed the cognitive-complexity suppression, and
      kept each source file under 300 physical lines.
- [x] `scripts/smoke-mcp.mjs` — `runLocalMcpSmoke`: AP-229 split local MCP smoke
      phases into `scripts/lib/smoke-mcp-local.mjs` and removed the function-length
      suppression from the smoke driver.
- [x] `apps/stream/src/memory-artifact-live.ts` — `fetch`: AP-230 split routing,
      notify, and connect handling into `memory-artifact-live-*.ts` helpers and
      removed the cognitive-complexity suppression.
- [x] `apps/web/src/components/chrome/command-palette/CommandPaletteDialog.tsx`:
      AP-222 split keyboard/focus behavior into `use-command-palette-*.ts` and
      `command-palette-keyboard.ts`, and rendering into `CommandPaletteDialogView`,
      `CommandPaletteSearch`, `CommandPaletteResults`, and `CommandPaletteOption`.
      Removed cognitive-complexity and function-length suppressions.
- [x] `apps/web/src/components/chrome/command-palette/use-command-items.ts`:
      AP-223 split command item construction into `command-items-navigation.ts` and
      `command-items-actions.ts`. The hook now composes focused builders and passes the
      60 function-line / 15 cognitive-complexity ratchet targets.
- [x] `apps/cli/src/update-check.ts` — `runUpdateCheck` (was CC 17): extracted the
      version-comparison decision into a pure `decideUpdateMessage(...)` helper that
      returns the single line to print. The runner now just prints the result and
      passes the 15 cognitive-complexity target without a suppression.
- [x] Mechanical ratchet batch (AP-221 child, single PR): refactored the remaining
      mechanical offenders to the 15 cognitive target without suppressions —
      `scripts/{check-pr-preview-capacity,cleanup-pr-preview,cleanup-stale-pr-previews,deploy-pr-preview,ensure-job-queues,deploy}.mjs`
      (shared `scripts/lib/spawn-command.mjs` replaces five duplicated child-process
      callbacks; `deploy.mjs` extracted `classifySecret`/`planSecretsForApp`;
      `ensure-job-queues.mjs` extracted `createQueueWithRetry`),
      `packages/repo-lint/src/monorepo-policy.mjs` (`validateWorkspacePackages` 30->6,
      `validateDependencies` 17->7), `apps/web/src/routes/_authed.dashboard.tsx`
      (extracted `apps/web/src/lib/use-dashboard-stats.ts`),
      `apps/web/src/routes/al.$publicId.tsx` (extracted `resolveViewerState`),
      `apps/mcp/src/{forward,transport}.ts`, `apps/stream/src/index.ts`,
      `apps/apex/src/routes.ts`, `packages/db/src/audit/change-summary.ts`,
      `packages/billing/src/reconcile.ts`,
      `apps/api/src/routes/operator.ts` (`parseOperatorEventFilters` lookup table),
      and `scripts/lib/smoke-mcp-local.mjs` (`createMcpWorkerHttpServer` extracted
      `nodeRequestToFetch`/`writeFetchResponse`). Same PR anchored the `.claude`/
      `.codex` vitest excludes to the resolved root (`buildTestExcludes`) so tests
      run from a worktree checkout under `~/.claude/worktrees/`.

## Deferred to follow-up tickets (characterization tests first)

Three offenders carry real behavioral risk and are **not** suppressed in the
mechanical batch — they stay red against a limit of 15 until refactored under
their own tickets, each gated on writing characterization tests first. They
block the final cognitive-complexity drop to 15 (owned by the AP-221 epic; the
AP-247 pass tightened the other gates but left cognitive pinned at 30).

- AP-258 — `apps/api/src/agent-view.ts` — `signAgentViewContentUrls` (CC 22):
  URL signing on the read path, no direct tests.
- AP-259 — `packages/db/src/repository/workflows/upload-publish-workflow.ts:169`
  — repository-layer `publishRevision` (CC 27): core publish write path.
- AP-260 — `apps/cli/src/upgrade.ts:258` — `runUpgrade` (CC 23): in-place binary
  swap.

## Current target-wall areas

Measured against the final targets (15 cognitive complexity, 60 function lines,
300 file lines) on non-test source with inline suppressions disabled:

1. `packages/contracts`: contract/OpenAPI registries dominate size. Split route
   contracts and OpenAPI path registration by resource group before lowering
   file/function line limits.
2. `packages/db`: the local SQL executor and entity method bags are split. The
   remaining target-wall work is repository workflow duplication, schema size,
   and query/helper consolidation before lowering final limits.
3. `scripts`: local server, smoke, and deploy-preview remain large orchestration
   modules. Versioned rotation scripts are split; extract step tables and reusable
   runners in the remaining scripts before ratcheting repo-wide file limits.
4. `apps/api`: publish/revision orchestration is split (AP-142); operator filter
   parsing is now a lookup table. Remaining target-wall items are Agent View
   signing (deferred ticket), API index wiring, Live Updates, and web route file
   size.
5. `apps/web`: command palette and dashboard route components mix state,
   keyboard/focus behavior, data derivation, and rendering. Move behavior into
   hooks and small render modules.

## How to ratchet

1. Refactor one or more offenders; remove their inline suppressions.
2. Re-measure: `biome lint --only=complexity/noExcessiveCognitiveComplexity \
--only=complexity/noExcessiveLinesPerFunction \
--only=nursery/noExcessiveLinesPerFile .`
3. Lower the corresponding limit in `biome.json` to just above the new max.
4. Repeat until the ratchet targets are reached, then delete this file.
