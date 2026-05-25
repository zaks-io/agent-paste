# Status Docs

`docs/ops/project-status.md` remains the first status file to read after
`AGENTS.md`, `CONTEXT.md`, `docs/specs/README.md`, and `docs/adr/README.md`.
This directory holds the smaller ledgers that used to make that file hard to
scan.

## Files

- [`../project-status.md`](../project-status.md) - current snapshot, active
  next step, and links into the ledgers below.
- [`phase-backlog.md`](./phase-backlog.md) - ordered remaining work, grouped by
  delivery phase. This is the file to update when the next implementation slice
  changes.
- [`implementation.md`](./implementation.md) - current component map, missing
  packages/apps, and verification state.
- [`coverage.md`](./coverage.md) - spec and ADR coverage ledger, including
  deferred and drifted docs.
- [`hosted-ops.md`](./hosted-ops.md) - hosted environment, secrets, deploy, and
  smoke-test status.
- [`changelog.md`](./changelog.md) - completed work, newest first.

Feature-specific todo files stay next to these ledgers:

- [`../web-app-todo.md`](../web-app-todo.md) - Phase 3 web/dashboard close-out.
- [`../live-updates-todo.md`](../live-updates-todo.md) - ADR 0069 Live Updates.
- [`../repository-todo.md`](../repository-todo.md) - repository-core follow-ups.
- [`../runbook-rotation.md`](../runbook-rotation.md) - current manual secret
  rotation procedure and future rotation gaps.
- [`../runbook-logpush.md`](../runbook-logpush.md) - parked Logpush/Axiom work.

## Maintenance Rules

- Keep `project-status.md` short enough to answer "what is true right now?"
  without scrolling through historical detail.
- Put ordered future work in `phase-backlog.md`.
- Put completed work in `changelog.md`, not in the active backlog.
- Update `coverage.md` when a new ADR or spec file is added, or when a
  previously partial/deferred decision is implemented.
- Update `implementation.md` when an app/package moves from scaffolded to
  implemented, or when a planned app/package is added.
