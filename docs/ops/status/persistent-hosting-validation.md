# Persistent hosting integration validation

Validation started on 2026-11-02 at parent head
`5b1c1a0bb57df43347640fe06718ee79f2e5eb73`. Integration changes are local and
not deployed. No production requests, remote migrations, or removal of old
Artifact data are part of this validation.

## Environment and commands

Node 24.21.0, pnpm 10.34.5, the assigned T3 worktree, Turbo concurrency 2,
and Vitest maxWorkers 2. Large fixtures use the disk-backed `sbx-runtime`
worktree state directory. Raw logs and credentials remain outside commits.

```sh
pnpm install --frozen-lockfile
pnpm exec turbo run build --filter=@agent-paste/api --filter=@agent-paste/upload --filter=@agent-paste/content --filter=@agent-paste/jobs --filter=@agent-paste/stream --filter=@agent-paste/mcp --filter=@zaks-io/agent-paste --concurrency=2
pnpm --filter @agent-paste/upload exec vitest run --maxWorkers=2
pnpm --filter @agent-paste/db exec vitest run src/local-mvp-sql-executor.test.ts --maxWorkers=2
pnpm exec vitest run --config vitest.scripts.config.ts scripts/memory-worker-bindings.test.mjs
node scripts/smoke-local-transfers.mjs
```

The upload suite passed 80 tests. The local SQL projection regression failed
before its fix, then all 16 adapter tests passed. The R2 conditional-write
regression failed before its fix and passed afterward.

## Local endpoint acceptance

The driver provisions a disposable workspace through `__test__/provision-smoke`
and passes its API key through the child environment. HTTP requests run the
built API, Upload and Content Workers in Node. Capability origins use the
`transfers.test` domain through a local HTTP proxy that preserves the capability
Host header. The stable-URL assertion is unchanged. Signed `/v` read grants
continue through the ordinary Content route.

The complete large-transfer run and final repository gates are in progress.
Parent review has identified two quota blockers. Parent owns their fixes:
post-write map quota rejection must retain accounting for the R2 object, and
uploaded SHA-less revision staging files must remain included in usage.
These failures must pass their regression tests before integration is ready.

## Remaining preview checks

- Deploy to an approved preview and rerun transfers with real R2, Postgres,
  native rate-limit bindings and the managed CLI gateway. The local rate-limit
  bindings always allow requests.
- Inspect API, Upload and Content Worker analytics for `exceededMemory` and
  `exceededCpu`. Node CLI RSS does not prove the Worker 128 MiB limit or
  production telemetry.
- Load a site with at least 2,000 assets in a browser, reload changed HTML,
  inspect cache revalidation and browser errors, and confirm the preview
  capability hostname and gateway routes.
- Confirm storage usage falls after deletion and delayed GC with the preview
  budget fixture. Local reservation tests and repository GC tests provide
  separate evidence, not hosted cleanup acceptance.
- Parent must finish the independent Astra review and resolve all findings.
  Production migration, deployment and any old-data removal require separate
  explicit approval.
