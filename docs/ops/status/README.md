# Status Docs

`docs/ops/project-status.md` remains the first status file to read after
`AGENTS.md`, `CONTEXT.md`, `docs/specs/README.md`, and `docs/adr/README.md`.
This directory holds the smaller ledgers that used to make that file hard to
scan.

## Files

- [`../project-status.md`](../project-status.md) - current product and release
  snapshot with links into the ledgers below.
- [`phase-backlog.md`](./phase-backlog.md) - historical phase ordering and the
  remaining non-architecture work recorded on 2026-06-15.
- [`implementation.md`](./implementation.md) - historical component and
  verification snapshot from 2026-06-15.
- [`coverage.md`](./coverage.md) - historical spec and ADR coverage snapshot
  from 2026-06-05.
- [`hosted-ops.md`](./hosted-ops.md) - operational environment, secret routing,
  deploy, and smoke-test ledger. Verify mutable hosted state before acting.
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
- Put a current next step in `project-status.md` only when one has been
  established from the issue tracker; preserve `phase-backlog.md` as historical
  sequencing unless it is deliberately refreshed.
- Put completed work in `changelog.md`, not in the active backlog.
- Update the relevant spec and ADR index when coverage changes; preserve
  `coverage.md` as its dated snapshot.
- Add current component ownership to `docs/development.md`; preserve
  `implementation.md` as its dated snapshot.
