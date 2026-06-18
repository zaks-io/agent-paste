# Mutation testing (StrykerJS pilot)

Tracking: [AP-371](https://linear.app/zaks-io/issue/AP-371). Status: advisory pilot, local-only.

## What it is and why

Line coverage proves a line _ran_ during a test. It does not prove a test would
_fail_ if that line's behavior changed. Mutation testing closes that gap:
[StrykerJS](https://stryker-mutator.io/) makes small changes to source (flip `>`
to `>=`, delete a statement, swap `&&`/`||`, replace a return value) and checks
whether the existing tests catch each change. A "survived" mutant is a behavior
change no test noticed — a real hole in the suite. This is especially valuable
after heavy AI-agent implementation, where tests can be present and green yet
assert too little.

It is a **different metric from coverage** and does not replace it. See
[coverage.md](status/coverage.md) for the line-coverage gates.

## How it is wired

- **Per package, opt-in.** Six high-value pure-logic packages each have a
  `stryker.conf.json` and a `test:mutation` script. Run one with the root
  convenience script `pnpm mutation:<pkg>` (`tokens`, `revise-core`, `storage`,
  `billing`, `rotation`, `write-allowance`) or directly:
  `pnpm --filter @agent-paste/<pkg> test:mutation`.
- **Not in `verify`, `test`, Turbo, or CI.** Mutation runs are slow and a first
  pass surfaces a long tail of survivors; keeping them out of the blocking gate
  is deliberate. Thresholds are advisory (`break: null` — the command never
  fails on score).
- **Reports** land in `packages/<pkg>/reports/mutation/` (`index.html` +
  `mutation.json`), gitignored. Open the HTML report to inspect survivors.
- **Scope is high-value source files only**, not whole `src/`. Barrels
  (`index.ts`), thin helpers, and infra glue are excluded; each config's
  `mutate` list names the files.
- Stack: `@stryker-mutator/core` + `vitest-runner` + `typescript-checker`
  (catalog-pinned, lockstep), Vitest 4, Node 24.

### Gotchas (carried into every config)

- **Explicit `plugins`.** Under pnpm `nodeLinker: isolated`, Stryker's default
  plugin glob does not find the typescript-checker. Every config lists
  `plugins: ["@stryker-mutator/vitest-runner","@stryker-mutator/typescript-checker"]`.
- **`.stryker-tmp` is excluded from Vitest.** A crashed run leaves sandbox
  copies that a plain `vitest run` would otherwise scan and choke on. Excluded
  in `vitest.config.ts` and `vitest.shared.config.ts`. If a package's normal
  tests suddenly fail inside `.stryker-tmp/sandbox-*/`, run
  `rm -rf packages/*/.stryker-tmp`.
- **Integration tests cannot run in the sandbox.** `billing` has
  `*.integration.test.ts` that reach outside the package (real pglite + DB
  credentials), which breaks when Stryker relocates the package. `billing` uses
  `vitest.stryker.config.ts` to exclude them and narrows `mutate` to the
  unit-covered files. Consequently its score reflects unit coverage only.
- **Changing a `mutate` list requires deleting `.stryker-tmp/incremental.json`**
  (or the whole `.stryker-tmp`), or the report merges stale results for files
  you removed. `--force` retests mutants but does not drop old files from the
  report.

## Baseline (first run, 2026-06-17)

Mutation score = killed / (killed + survived + no-coverage), excluding mutants
the typescript-checker discarded as non-compiling. Scores are advisory.

| Package                      | Score | Strongest file                     | Weakest file                  |
| ---------------------------- | ----- | ---------------------------------- | ----------------------------- |
| revise-core                  | 69%   | `apply-edits.ts` **100%**          | `unified-diff-gen.ts` 65%     |
| tokens                       | 76%   | (overall)                          | `access-link.ts` 70%          |
| storage                      | 71%   | `artifact-bytes-encryption.ts` 76% | `workspace-blob-bytes.ts` 50% |
| billing (unit-covered files) | 67%   | `drift.ts` **100%**                | `reconcile.ts` 31%            |
| rotation                     | 51%   | `pepper-ring.ts` 78%               | `rotation-plan-steps.ts` 34%  |
| write-allowance              | 64%   | (`counter-state.ts`)               | `counter-state.ts` 64%        |

### What the pilot found (real gaps, not noise)

- **`apply-edits.ts` (revise-core) = 100%** — the literal find/replace edit
  engine (ADR 0091) has airtight tests. Reassuring for a security-relevant path.
- **rotation orchestration is under-asserted.** `rotation-plan-steps.ts` (34%)
  and `automation.ts` (44%) score low: the tests exercise the happy path but not
  the branch/ordering logic of the key/pepper rotation state machines. Highest-
  value gap surfaced. Follow-up: [AP-378](https://linear.app/zaks-io/issue/AP-378).
- **`billing/reconcile.ts` (31%)** is mostly exercised by the excluded
  integration tests; it lacks _unit_ coverage of its branch logic. Follow-up:
  [AP-379](https://linear.app/zaks-io/issue/AP-379).
- **`tokens/access-link.ts` (70%) and `write-allowance/counter-state.ts` (64%)
  survivors** — the latter cluster on the `nextReservations.length > 0 ? {...} : {}`
  shorthand (nothing asserts the exact shape of `next`: empty list omitted vs
  stored as `[]`). Follow-up: [AP-380](https://linear.app/zaks-io/issue/AP-380).

## Interpreting survivors (triage rules)

Not every survivor is a missing test. Before acting:

1. **Equivalent mutants** — a change that produces behavior indistinguishable
   from the original (e.g. `Math.max(0, x)` where `x` is already proven `>= 0`,
   or reordering independent statements). These _cannot_ be killed; ignore them,
   don't contort a test to chase them.
2. **Cosmetic / formatting-shaped mutants** — string-literal or object-shorthand
   mutants where the value is never asserted because the value is genuinely
   not part of the contract. Per house rule, do **not** add a test that pins
   wording/shape just to kill the mutant. Add an assertion only if the value is
   a real contract.
3. **Real gaps** — a boundary (`<=` vs `<`), an arithmetic op, a dropped branch,
   or a return value that flips behavior and no test notices. These are worth a
   test. Prefer strengthening an existing test's assertions over adding new ones.

See StrykerJS [mutant states and metrics](https://stryker-mutator.io/docs/mutation-testing-elements/mutant-states-and-metrics/).

## Next decision

The pilot works and the baseline is recorded. Open questions for a later ticket:

- Keep advisory, or promote one stable target (e.g. `apply-edits.ts` at 100%,
  or `tokens`) to an enforced `break` threshold once survivors are triaged.
- Add a `workflow_dispatch`-only CI workflow that uploads the HTML report as an
  artifact (advisory; not in the `Validate` gate).
- Expand to a publish-path hotspot (`apps/upload/src/finalize.ts` or the
  repository `upload-publish-workflow.ts`) — explicitly out of scope for this
  first slice.
