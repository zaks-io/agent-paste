# Code duplication limit: ratchet plan

Source of truth for the jscpd copy-paste gate and the duplication that is
currently tolerated. Owner: Isaac. Snapshot date: 2026-06-05.

jscpd 4.2.x enforces a single duplication `threshold` in `.jscpd.json` (run via
`pnpm dupes` -> `node scripts/jscpd-check.mjs`, wired into `pnpm verify` after
`pnpm knip`). The build fails when total duplicated lines exceed the threshold
percentage.

## Scope

The gate covers **shipped code only**: `apps/` and `packages/`. It does not scan
`scripts/`, tests, generated files, or vendored output. Rationale:

- Duplication concentrates in `scripts/*.mjs` (PR-preview and secret-rotation
  glue), which churns fast and is low-stakes; gating it would just generate
  noise and block unrelated PRs. Shipped code is what users depend on.
- Tests legitimately repeat setup/assertions, same as the complexity gate's
  test exemption. See [complexity-todo.md](./complexity-todo.md).

Ignored globs (in `.jscpd.json`): `node_modules`, `dist`, `.turbo`,
`.wrangler`, `coverage`, `*.gen.ts`, `worker-configuration.d.ts`,
`openapi/*.json`, and all `*.test.*` / `*.spec.*` / `__tests__` / `test`.
Known friction: helpers under `src/test-helpers/` are currently scanned because
that path is not covered by the ignore list. They contribute real duplicated
lines today but are test support, not shipped runtime behavior.

| Setting     | Current value | Next step  | Ratchet target |
| ----------- | ------------- | ---------- | -------------- |
| `minTokens` | 50            | stay at 50 | stay at 50     |
| `threshold` | 2.5 (%)       | 2.3 (%)    | 1.5 (%)        |

The threshold is set to the tightest value that is **green today without a wave
of refactors**. It started at `3` (baseline 2.84%); quick-win extractions pulled
the baseline below the `2.7` gate, and AP-203 pulled it below the `2.5` gate.
The current baseline is **2.45%**, so `2.5` has little slack. The next step
(`2.3`) needs another offender cleanup or a decision to stop scanning
`src/test-helpers/`. Lower the threshold in `.jscpd.json` as offenders are
cleaned up and update this file.

## Baseline distribution (gated scope, 2026-06-05)

Measured by `pnpm dupes --reporters json --output /tmp/agent-paste-jscpd-final2` at
`minTokens: 50` over `apps` + `packages`:

- 507 files, 45,808 lines analyzed.
- 109 clones, 1,124 duplicated lines = **2.45%** (2.84% by tokens).
- Post AP-206 MCP dedup (2026-06-05): 507 files, 45,795 lines, 1,067 duplicated
  lines = **2.33%** (2.71% by tokens).
- By format: TypeScript 2.64%, TSX 1.27%, JavaScript 0%.

For reference, `scripts/` alone is 9.46% (62 clones, 810 duplicated lines over
8,558 lines). That gap is why `scripts/` is out of scope.

## Done: first dedup round

These quick wins shipped with the gate (2.84% -> 2.59%):

- [x] `appErrorResponse` / `jsonResponse`: removed byte-identical local response
      wrappers in `apps/api/src/responses.ts` and `apps/upload/src/index.ts`;
      the docs-URL-aware error wrapper now lives in
      `packages/worker-runtime/src/errors.ts`.
- [x] Byte-purge invalidation twins: extracted `writeDenylistKey` and
      `enqueueBytePurge` into `packages/db/src/byte-purge-shared.ts`;
      `artifact-invalidation.ts` and `revision-invalidation.ts` are now thin
      callers that differ only by KV prefix / purge prefix.
- [x] MCP Access Link + forwarding dedup (AP-206): extracted
      `createAndMintAccessLink` in `apps/mcp/src/tools.ts` and
      `forwardToBinding` in `apps/mcp/src/forward.ts`; gated baseline
      **2.33%** (was 2.45%).

## Done: AP-203 repository workflow dedup

This pass moved the gated baseline from 2.54% to 2.45%:

- [x] Shared active-artifact lookup, artifact audit insertion, delete-result
      mapping, and web artifact pagination in
      `packages/db/src/repository/workflows/artifact-workflow-helpers.ts`.
- [x] Reused those helpers from member artifact, web dashboard, access-link, and
      workspace-admin workflows.
- [x] Collapsed the workspace replay peek wrappers into one implementation with
      explicit exported aliases.

## Where the duplication lives

Cleaning these dirs is what moves the threshold:

- [ ] `packages/db/src/repository/workflows/*` — `web-dashboard-workflow.ts`,
      `member-artifacts-workflow.ts`, `access-links-workflow.ts`, and siblings
      repeat row-mapping, pagination, command setup, and Audit Event boilerplate.
      Largest single runtime source of clones.
- [ ] `apps/api/src/routes/*` — `web.ts`, `billing.ts`, `smoke.ts`, and
      `responses.ts` repeat member resolution, pagination parsing, response
      wrapping, and repository-error handling.
- [ ] `packages/db/src/repository/web-transforms.ts` — repeated transform
      shapes (3 clones).
- [ ] `packages/db/src/queries/*` and `local-entities/*` — repeated query
      scaffolding (`operation-events.ts`, `artifacts.ts`).
- [ ] `packages/db/src/local-mvp-sql-executor.ts` — repeated statement-handler
      bodies (also a complexity offender; refactoring helps both gates).
- [ ] `packages/contracts/src/openapi/*` and `mcp/registry.ts` — repeated
      schema/registration blocks (largest single clone: 45 lines in
      `mcp/registry.ts`).
- [ ] `apps/web/src/components/*` — `AccessLinksTable` / `KeysTable`,
      `MintedUrlReveal` / `Identifier`, and a few route loaders repeat table
      state and small UI patterns.
- [ ] `apps/upload/src/create-session.ts` and `finalize.ts` — repeated
      authenticated upload-route repository error handling.
- [ ] `apps/jobs/src/test-helpers/*` and `packages/billing/src/test-helpers/*`
      — repeated PGlite migration/RLS helper setup. Either extract a shared test
      helper or stop scanning `src/test-helpers/`.
- [ ] `packages/rotation/src/automation.ts` — 2 clones in plan-building.

Some jscpd hits are intentional parallel implementations, not copy-paste, and
should be left alone: `apps/stream/src/artifact-live.ts` vs
`memory-artifact-live.ts` (DurableObject vs in-memory), the per-domain jobs
queue/discovery handlers, and `schema.ts` column blocks (clearer flat than
abstracted). The repeated smoke-script helpers under `scripts/` are also outside
the gate by design.

## How to ratchet

1. Refactor one or more offender dirs above (extract shared helpers).
2. Re-measure: `pnpm dupes` (or `pnpm dupes --reporters json` for a machine
   summary).
3. Lower `threshold` in `.jscpd.json` to just above the new percentage.
4. Repeat until the ratchet target (1.5%) is reached, then delete this file.
