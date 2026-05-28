# Autonomous Agent Loop

This is the detailed state contract for agents running the `agent-paste`
backlog. Use it with `docs/agents/workflow.md`.

## Queue

The queue is Linear team `AP`, project `agent-paste Roadmap`. Start in the
earliest active milestone from `docs/agents/issue-tracker.md` unless the user
names a different target.

Agent-ready work must be:

- labeled `ready-for-agent`
- unblocked
- scoped to one PR
- backed by enough acceptance criteria to verify completion
- free of unresolved product, security, credential, provider, or ADR decisions
- explicit about cross-layer invariants when the work touches auth, deletion,
  idempotency, Access Links, Live Updates, migrations, background jobs, or
  public contracts

Cursor work must also be labeled `remote-cursor`.

## Queue-Moving Loop

On each run:

1. Read `AGENTS.md`, `docs/ops/project-status.md`,
   `docs/ops/status/phase-backlog.md`, `docs/agents/workflow.md`, and
   `docs/agents/issue-tracker.md`.
2. List active Linear issues in `Todo`, `In Progress`, `Blocked`, `In Review`,
   `Changes Requested`, and `Ready to Merge`.
3. Check PR state for active work before starting new work.
4. Include agent-ready issues filed by
   `agent-paste-goal-review-main-and-queue-fixes` in the same implementation
   queue as other `Todo` + `ready-for-agent` work.
5. Select the next issue by milestone order, priority, dependency state, risk,
   and file/package contention.
6. Choose the executor from `docs/agents/environment-adapters.md`.
7. Build a worker prompt package with the issue, linked docs, required checks,
   branch expectation, and explicit stop conditions.
   For risky cross-layer work, include the governing ADR/spec lines, accepted
   principals, replay expectations, post-commit invalidation order, and the
   focused retry/destructive-path tests the worker must add or preserve.
8. Record delegation in Linear when a worker is assigned.
9. Watch for PRs, failed checks, stale branches, blockers, and review comments.
10. Update Linear using the state contract below.

## Worker Loop

Workers should:

1. Read the required context and the assigned Linear issue.
2. Confirm the issue is ready for that runtime.
3. Claim the issue and move it to `In Progress`.
4. Create or use one branch for the issue. Include `AP-<number>` in the branch
   name when the queue-moving loop did not assign a branch.
5. Implement only the stated scope.
6. Run ticket-specific checks first, then broader checks as needed.
7. Run or request `agent-paste-local-code-review` before PR handoff.
8. Open a ready-for-review PR, link the Linear issue, and move the issue to
   `In Review`.

## Review And Fix Loop

The queue-moving loop owns the review/fix loop. It should review PRs from an
isolated local worktree or review subagent, then route actionable feedback
through normal GitHub PR review comments.

When review finds actionable implementation feedback:

1. Post detailed findings on the PR.
2. Move the Linear issue to `Changes Requested`.
3. Return to the original worker thread whenever possible so the same remote
   environment, branch, and PR can continue.
4. Tell the worker which PR comments, failed checks, acceptance gaps, and
   security concerns must be addressed.
5. After the worker pushes fixes, rerun review from a clean local worktree.
6. Move the issue back to `In Review` for another review pass, then to
   `Ready to Merge` only after review and required checks are clean.

The queue-moving loop should not become the local implementer for ordinary
review feedback. It may make bookkeeping updates, verify checks, and escalate
important problems, but implementation fixes should stay with the assigned
worker unless the original worker thread is unavailable or a human redirects the
work.

## Linear State Contract

| State               | Agent behavior                                                        |
| ------------------- | --------------------------------------------------------------------- |
| `Todo`              | Eligible only when labels, dependencies, and body detail are ready.   |
| `In Progress`       | Active implementation. Do not take over without assignment.           |
| `Blocked`           | Comment with the blocker; do not improvise around missing decisions.  |
| `In Review`         | PR opened and ready for review.                                       |
| `Changes Requested` | Review found actionable feedback; continue on the same branch and PR. |
| `Ready to Merge`    | Review is clean and required checks pass.                             |
| `Done`              | Complete. Do not modify without a follow-up issue.                    |
| `Canceled`          | Closed intentionally. Do not modify.                                  |

## Stop Conditions

Stop and ask for human input when work needs:

- product scope not captured in the issue
- a new or changed security posture
- credentials, provider approval, or hosted production access
- an ADR decision or contradiction
- destructive data changes not explicitly requested
- a merge, deploy, or production smoke that has not been authorized
