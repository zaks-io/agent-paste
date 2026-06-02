# Code complexity limits: ratchet plan

Source of truth for the Biome complexity/size gates and the offenders that are
currently suppressed. Owner: Isaac. Snapshot date: 2026-06-02.

Biome 2.4.x enforces three rules in `biome.json` (part of `pnpm lint` ->
`biome lint .`). Tests are exempt via an override
(`**/*.test.*`, `**/*.spec.*`, `**/test/**`, `**/__tests__/**`) because they
legitimately run long.

| Rule                             | Group      | Current limit                | Ratchet target                              |
| -------------------------------- | ---------- | ---------------------------- | ------------------------------------------- |
| `noExcessiveLinesPerFile`        | nursery    | 600 lines (`skipBlankLines`) | 300 (matches the repo file-size convention) |
| `noExcessiveLinesPerFunction`    | complexity | 100 lines (`skipBlankLines`) | 60                                          |
| `noExcessiveCognitiveComplexity` | complexity | 30                           | 15 (Biome default)                          |

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

Each is flagged inline; clean up and remove the suppression. Values are the
Biome-measured count at snapshot time.

### Cognitive complexity (> 30)

- [ ] `packages/db/src/local-mvp-sql-executor.ts` — `query` dispatcher: 102. Big
      SQL branch table; split per statement family.
- [ ] `apps/api/src/routes/revisions.ts` — `publishRevision` idempotent body: 62.
- [ ] `scripts/lib/versioned-secret-rotation.mjs` — `executeStep`: 44.
- [ ] `packages/worker-runtime/src/registrar.ts` — `routeHandler`: 41.
- [ ] `packages/db/src/repository/local-entities/artifacts.ts` —
      `reparentWorkspace`: 39.
- [ ] `apps/stream/src/memory-artifact-live.ts` — `fetch`: 35.
- [ ] `apps/web/src/components/chrome/command-palette/CommandPaletteDialog.tsx` —
      `handleKeyDown`: 32.
- [ ] `scripts/lib/versioned-secret-rotation.mjs` — `formatPlan`: 31.

### Lines per function (> 100)

- [ ] `packages/contracts/src/openapi/api.ts` — `buildApiOpenApiDocument`: 360.
      Mostly flat schema registration; could split per resource group.
- [ ] `packages/db/src/local-mvp-sql-executor.ts` — outer factory 192, inner
      `query` 183.
- [ ] `packages/db/src/repository/local-entities/artifacts.ts` —
      `localArtifacts`: 147.
- [ ] `scripts/smoke-mcp.mjs` — `runLocalMcpSmoke`: 133.
- [ ] `packages/db/src/repository/postgres-entities.ts` — `postgresEntities`: 122.
- [ ] `packages/rotation/src/automation.ts` — `buildRotationPlan`: 116.
- [ ] `apps/web/src/components/chrome/command-palette/CommandPaletteDialog.tsx` —
      `CommandPaletteDialog`: 124.

### Lines per file (> 600)

None today. Worst source file is `apps/upload/src/index.ts` at 584. When the
file limit ratchets below ~590 it becomes the first to address.

## How to ratchet

1. Refactor one or more offenders; remove their inline suppressions.
2. Re-measure: `biome lint --only=complexity/noExcessiveCognitiveComplexity \
--only=complexity/noExcessiveLinesPerFunction \
--only=nursery/noExcessiveLinesPerFile .`
3. Lower the corresponding limit in `biome.json` to just above the new max.
4. Repeat until the ratchet targets are reached, then delete this file.
