# Persistent hosting integration validation

Validation on 2026-11-02 and 2026-11-03 started at parent
`5b1c1a0bb57df43347640fe06718ee79f2e5eb73`. The combined application and
behavior-test head is `6043f2a648f0009858cb81660fa5cbd29d0640f2`.
The final smoke harness and full-soak head is
`a3ff2e4f4909ad2897b3ab8d6a377979da417caa`; its changes affect scripts and
their documentation only. Application sources, workspace coverage configuration and
thresholds are identical between these heads.

Parent fixes are included: staging accounting `266a3313` as `afac626d`,
SQL-only map registration and post-commit materialization `ba592866` as
`fbd23798`, and map exclusion from upload deduplication `4aecec3f` as
`caa74c7c`. These changes are local and not deployed. Validation used disposable
local state and one scoped Postgres container. No production requests, remote
migrations or deletion of old Artifact data occurred.

## Environment and repository gates

Node 24.21.0 and pnpm 10.34.5 in the assigned T3 worktree. Turbo concurrency
is 2, Vitest maxWorkers is 2, and pre-commit typecheck concurrency is 1.
Large fixtures use the disk-backed `sbx-runtime` worktree state directory.
Raw logs, generated credentials and signed URLs remain outside commits.

The following commands passed sequentially. `pnpm verify` passed again at
`a3ff2e4f` after the MCP smoke changes. Strict workspace coverage ran fresh at
`6043f2a6`; script coverage ran fresh again at `a3ff2e4f`.

```sh
pnpm verify
pnpm test:coverage:strict
pnpm test:scripts --coverage
pnpm exec turbo run build --filter=@agent-paste/api --filter=@agent-paste/upload --filter=@agent-paste/content --filter=@agent-paste/jobs --filter=@agent-paste/stream --filter=@agent-paste/mcp --filter=@zaks-io/agent-paste --concurrency=2
```

| Gate                        | Result                                                                                        |
| --------------------------- | --------------------------------------------------------------------------------------------- |
| Full verification           | 113/113 Turbo tasks; 3,303 workspace tests and 578 script tests passed                        |
| Strict workspace coverage   | 42/42 tasks; 3,217 tests passed; all 25 workspace reports merged                              |
| Merged coverage             | Statements 90.28%, branches 82.31%, functions 91.63%, lines 91.39%                            |
| Script coverage             | 578 tests across 50 files; statements 89.77%, branches 84.06%, functions 89.51%, lines 90.02% |
| Required service/CLI builds | 21/21 tasks passed                                                                            |
| Commit hooks                | Biome where applicable, Prettier, staged secret scan and 44 typecheck/build tasks passed      |

Verification includes code/docs format, Knip, duplicate detection, dependency
cycles, lint, typechecks, unit/integration tests, generated OpenAPI consistency,
DB schema and RLS checks, and script typecheck/tests. The workspace runs have
three Postgres-only skips and one adapter-specific skip. The Postgres-only
cases ran in the isolated Postgres check below. The adapter-specific skip is
the SQL variant of a local read-transaction test; its local variant passed.

The first strict run exposed 81.40% merged branch coverage. New behavior tests
cover upload target pagination after acknowledged chunks disappear, invalid
and cross-session cursors, workspace isolation, chunk verification/completion,
expired sessions, listing integrity and guarded deletion planning. The fresh
rerun passed the existing 82% branch floor. No floors or exclusions changed.

## Fixes found by integration

- The local jobs SQL adapter dropped `content_format`, so chunked-file safety
  scanning fetched a virtual key. Its regression failed before the projection
  fix; all 16 adapter tests then passed.
- The local R2 fixture lacked ETag/conditional-write behavior. A regression
  failed before the fixture fix and passed afterward.
- Client and DB upload type imports formed dependency cycles. Pure type leaf
  modules preserve the public exports; dependency checks pass.
- Local MCP discovery expected 11 tools after pin/unpin raised the registry to 13. The smoke now uses the contract registry, verifies every tool name, and
  exercises authenticated pin/unpin with stable URL and fresh-expiry checks.
  A test failed before the registry fix and passed afterward. The MCP fixture
  now supplies a durable test capability hostname required by retention.
- Removed the unused `PINNED_ARTIFACT_CAP` export and re-export. Pin allowance
  continues to use workspace policy. The proposal now documents pull's
  exclusive-copy installation and interrupted-install overwrite recovery.

## Postgres and original endpoint smokes

The disposable driver `/tmp/integration-postgres-driver.mjs` ran:

```sh
node scripts/smoke-ci-postgres.mjs
```

It started one `postgres:17-alpine` container with a worktree-specific name,
`sbx.agent` ownership label, 1 GiB memory and two CPUs. Owner/runtime passwords
were generated internally and supplied through child environment variables.
The driver stopped and removed only that container and its disposable data.

All 11 files passed: 72 tests and one adapter-specific skip. The wrapper ran
upload delete-only and migration regressions, guarded commits, lifecycle,
staging accounting, upload recovery, map deduplication, map registration,
materialization/recovery and content-blob GC. The actual Postgres map share-lock
and GC races ran. Its CLI smoke also passed publish, bundle, deletion, expiry,
ephemeral publish and claim through the Postgres/RLS-backed API.

After the bounded build, the local smoke driver
`/tmp/integration-local-smokes-driver.mjs` allocated isolated ports and ran:

```sh
node scripts/smoke-local-mvp.mjs
node scripts/smoke-local-patch.mjs
node scripts/smoke-mcp.mjs local
```

All passed. Patch reconstruction and agent read-back used real encrypted local
bytes. MCP used its local OAuth/WorkOS fixture and service-binding forwarding,
including publish/read, pin/unpin, authentication boundaries and read-only
feedback. Raw smoke output was captured privately because it contains signed
URLs. These direct commands follow the same scripts as the package smoke
commands, with the shared build explicitly bounded.

## Large local endpoint acceptance

```sh
node scripts/transfer-soak.mjs --probe-self-test
node scripts/smoke-local-transfers.mjs
```

The driver provisions a disposable workspace through `__test__/provision-smoke`
and passes its key only in the child environment. Requests run the built API,
Upload and Content Workers through real HTTP in Node. Capability origins use
`transfers.test` through a local HTTP proxy that preserves the capability Host.
The stable-URL assertion is unchanged. Signed `/v` grants still use the ordinary
Content route, and byte serving is preserved.

The probe self-test and full soak passed at `a3ff2e4f`. All 10 soak scenario
groups and four additional HTTP fixture groups passed. The soak made 176 CLI
invocations, including the two intentional interruptions and client oversize
rejection. Peak sampled CLI RSS was **250,352 KiB, or 244.5 MiB**, below the
400 MiB cap.

| Acceptance                 | Observed result                                                                                                        |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 250 MiB file               | Incompressible publish, capability GET, Range/206 and pull all passed with matching hashes                             |
| Oversize                   | A 262,144,001-byte file was rejected by both CLI and server                                                            |
| Small tree                 | 8,001 files including the entrypoint, 1,073,744,050 bytes; complete source/destination hashes matched                  |
| Mixed tree                 | Four 250 MiB files, 200 small files and entrypoint; 205 files, 1,073,742,050 bytes; all hashes matched                 |
| Upload interruption        | Killed after one acknowledged 4,194,304-byte chunk; zero acknowledged digests resent                                   |
| Pull interruption          | Persisted 1,065,850 bytes before kill; resumed with `Range: bytes=1065850-`, received 206, and matched the source hash |
| No-op                      | Zero PUTs, zero uploaded bytes, same Revision; separate HTTP fixture confirms revision count unchanged                 |
| Partial/concurrent commits | Omitted bytes preserved, disjoint commits survived, overlapping and prefix-race commits conflicted                     |
| Retention/updates          | Pin/unpin passed; all 150 updates retained the exact capability URL                                                    |
| Concurrent transfers       | Three unique 250 MiB sources uploaded in full, then pulled and hash-verified concurrently                              |
| Compatibility/bundles      | Legacy strict response passed; chunked bundle disabled with `revision_too_large`; small ZIP passed in original smoke   |

Private evidence remains under:

```text
/home/p-agent-paste/.local/state/sbx-worktrees/7c944e2cf9bef7f749ed/local-transfers-eo4stP/
```

`report.json` records sanitized transfer counters and per-invocation RSS.
`local-evidence.json` records the tested head and HTTP fixture outcomes.
Raw error logs remain private. The driver closed its owned servers, and the
final owned-process check showed no remaining diagnostic service.

The additional HTTP fixtures pass unchanged-publish revision count and zero
uploaded bytes, service past former expiry while pinned, a fresh policy window
on unpin, `exp:null` after re-pin, stable capability updates, one-hour CSS cache
policy and unchanged ETag 304 across Revisions, actual expired signed PUT
rejection followed by target renewal, and exactly one concurrent 1 GiB
reservation admitted under a 1.5 GiB workspace budget.

## Remaining preview checks

- Rerun acceptance on an approved preview with real R2, Postgres, native
  rate-limit bindings and the managed CLI gateway. Local rate limits always
  allow requests. This is local acceptance evidence, not hosted rate-limit or
  gateway acceptance.
- Inspect API, Upload and Content Worker telemetry during the preview soak for
  `exceededMemory` and `exceededCpu`. Node CLI RSS does not prove the Workers
  128 MiB limit or production telemetry.
- Load at least 2,000 assets in a browser at the preview capability URL. Reload
  changed HTML, inspect browser errors, and verify asset cache revalidation.
  The local HTTP cache assertions do not replace this browser check.
- Confirm preview storage usage falls after Artifact deletion and delayed GC.
  Local quota races and actual Postgres GC tests passed, but hosted cleanup
  acceptance remains separate.
- Parent must finish independent review of the final QA changes and CodeRabbit
  review on the PR. Production migration, deployment and old-data removal remain
  outside this task.

## Parent integration and review

Parent integrated all six QA commits at `73a9d96c`. Its Git tree is identical to
`d2cbeaee` (`4e9d3fd66df7abf04ba335a8b8f8b91fe239aa4a`), so the validation
above applies to the integrated application and test sources.

Fresh GPT-6 Astra reviews confirmed that both original quota bypasses were fixed
at `ba592866`, then approved the map-deduplication follow-up at `4aecec3f` with
no findings. That final focused review ran 50 passing tests and reported three
intentional adapter/Postgres skips. It approves that delta, not deployment or
the separate hosted acceptance checks above.

Tracking: [AP-490](https://linear.app/zaks-io/issue/AP-490).

## PR preview dashboard gate repair

PR #686 preview run [41565007603](https://github.com/zaks-io/agent-paste/actions/runs/41565007603)
deployed the preview and passed its hosted publish and patch smokes, then failed
the local Lighthouse dashboard gate. The authenticated dashboard returned 500
with `t.serverSsr?.isDehydrated is not a function`. The same failure reproduced
locally at `4fd9bfe8`.

The installed SSR query adapter called a method removed from the installed
router. Updating `@tanstack/react-router-ssr-query` to 1.167.3 and
`@tanstack/react-query` to 5.105.0 resolves the mismatch and satisfies the
adapter's Query peer requirement with one query-core version. Router and Start
versions are unchanged.

Validation on 2026-11-03 passed the 14-task web dependency build, all 305 web
tests, web typecheck, and `pnpm lighthouse:dashboard-a11y`. The rebuilt
authenticated dashboard rendered successfully and scored 95, meeting the
unchanged accessibility threshold. Lighthouse still reports contrast and
visible-label/name findings. This local result does not establish hosted
large-transfer acceptance; the preview workflow must run again after the fix.
