# Agent Workflow

This is the shared workflow for Codex, Claude, Cursor, and any future worker
runtime. Runtime-specific files should adapt this workflow, not replace it.

## Entrypoints

Start with:

1. `AGENTS.md`
2. `docs/ops/project-status.md`
3. `CONTEXT.md`
4. `docs/specs/README.md`
5. `docs/adr/README.md`
6. `docs/agents/repo-navigation.md`
7. `docs/agents/skill-usage.md`

Use `docs/agents/issue-tracker.md` for Linear operations and
`docs/agents/remote-cursor-agent.md` for Cursor Background Agent handoff.

## Agent Publish Surfaces

When a workflow needs to publish or inspect an Artifact, use the CLI if the
runtime can execute commands. Use MCP when the runtime is a hosted agent that
cannot run the CLI but can connect to remote MCP with OAuth. Do not recommend
any other publish surface for agent workflows.

Default CLI sequence:

```sh
agent-paste whoami
# If whoami reports no active login and interactive auth is possible:
agent-paste login
agent-paste publish <path>
# If login is not available:
agent-paste publish <path> --ephemeral
```

Run `agent-paste login` only when `whoami` shows no active login and
interactive auth is possible. Use `agent-paste publish <path> --ephemeral` only
when no login is available and interactive auth is not possible, or when the
user explicitly asks for accountless publish.

## Workflow

Work moves through six stages plus one sidecar review loop.

1. Roadmap and readiness

   Linear is the source of queued work. Use the `AP-` team and the
   `agent-paste Roadmap` milestones from `docs/agents/issue-tracker.md`.
   Agent-ready tickets must be scoped to one PR, unblocked, and labeled
   `ready-for-agent`. Cursor Background Agent work must also be labeled
   `remote-cursor`.

2. Implementation

   Use `ziw-implement` for one Linear issue and one branch. The
   worker claims the issue, moves it to `In Progress`, implements only the
   stated scope, and runs ticket-specific checks.

   For auth, deletion, idempotency, Access Link, Live Update, migration,
   background-job, and public contract work, the issue body should name the
   cross-layer invariants the worker must preserve. Do not rely on local unit
   shape alone. Spell out the affected ADRs/specs, accepted principals, replay
   behavior, post-commit invalidation, docs, and focused retry/destructive-path
   tests.

3. Pre-PR local review

   Use `ziw-code-review` before opening a PR. This catches scope
   drift, missing acceptance criteria, weak tests, security invariant gaps,
   debug output, and unrelated cleanup while the issue is still `In Progress`.

4. PR handoff

   Use `ziw-pr` after the local review is clean. PRs should be
   ready for review, include the Linear issue, summarize checks, and move the
   issue to `In Review`.

5. PR review and fix loop

   Use `ziw-review` to review the PR against the Linear issue,
   acceptance criteria, security invariants, tests, and docs. If review finds
   actionable feedback, post it on the PR, move Linear to `Changes Requested`,
   and send the original worker thread back to the same branch and PR.

6. Queue-moving loop

   Use `ziw-orchestrate` when coordinating multiple
   issues, worker runs, PR checks, and review loops. The queue-moving loop
   selects ready work, chooses the runtime, delegates with a complete prompt
   package, watches PRs, routes feedback, and escalates human decisions.

7. Review-main sidecar loop

   Use `ziw-review` for the periodic review
   agent that checks `origin/main` for new commits, reviews only the newly
   landed range from a disposable worktree, and files actionable Linear issues
   for bugs, security regressions, or product-contract drift. Issues created by
   this loop must still satisfy the normal Linear contract before they receive
   `ready-for-agent`; otherwise they stay in a non-agent-ready backlog state
   with the appropriate readiness label.

   This loop must explicitly inspect cross-layer contract drift. Recent misses
   have clustered around workflows where each local package looked reasonable
   but the combined behavior violated an ADR or runtime contract: idempotency
   replay before rate limiting for every accepted principal, publish/link
   side effects inside one retry boundary, and deletion/revocation invalidation
   visible to `content`.

## Queue-Moving Review Loop

For delegated implementation work:

1. The queue-moving loop assigns a ready Linear issue to a worker. Cursor
   Composer 2.5 is the preferred workhorse for isolated, well-scoped
   implementation tickets when the remote environment can run the needed
   checks.
2. The worker implements on one branch and runs the required checks.
3. Before PR handoff, the branch gets a local review pass with
   `ziw-code-review` where the environment supports it.
4. The worker opens a ready-for-review PR, links Linear, and moves the issue to
   `In Review`.
5. The queue-moving loop checks out the PR in a clean local worktree and
   reviews it with `ziw-review`, using the strongest available
   review model and reasoning tier.
6. Review findings are posted as normal GitHub PR review comments.
7. If changes are needed, Linear moves to `Changes Requested`.
8. The queue-moving loop replies in the original worker thread with the PR
   feedback, failed checks, acceptance gaps, and security concerns that must be
   addressed.
9. The worker pushes fixes to the same PR.
10. The queue-moving loop repeats clean-worktree review until checks and review
    are clean.
11. The issue moves to `Ready to Merge` only when required checks pass and the
    review gate is clean.

The local queue-moving loop should maximize throughput by selecting work,
preserving context, and routing ordinary fixes back to the assigned worker. It
should not quietly become the implementer for a stuck PR unless the original
thread is no longer usable or a human redirects the work.

Implementation and review have different defaults. Fast worker models are fine
for well-scoped implementation. PR review should use the strongest available
review tier, especially for auth, authorization, secrets, schemas, background
jobs, cross-package contracts, and destructive data paths.

Composer 2.5 can be used as an implementation workhorse for isolated,
well-specified tickets. Before scaling it across risky work, make the ticket
acceptance criteria concrete enough to force cross-layer verification and keep
an independent review gate on auth, authorization, deletion, idempotency,
Access Link, Live Update, migration, background-job, and public contract
changes.

## Status Contract

Use the configured Linear workflow state with these meanings:

| State               | Meaning                                                                           |
| ------------------- | --------------------------------------------------------------------------------- |
| `Todo`              | Ready queue or backlog; do not claim unless labels and blockers allow it.         |
| `In Progress`       | Someone is actively implementing. Do not claim unless assigned or delegated.      |
| `Blocked`           | Cannot continue until the blocker is resolved.                                    |
| `In Review`         | PR is open and ready for review.                                                  |
| `Changes Requested` | PR has actionable feedback; return to the original worker thread and same branch. |
| `Ready to Merge`    | Required checks and review are clean.                                             |
| `Done`              | Completed. Do not modify without a follow-up issue.                               |
| `Canceled`          | Intentionally closed without completion.                                          |

If `Changes Requested` is not configured in Linear, leave the issue in
`In Review`, add a comment identifying the requested changes, and ask the human
operator to add or map the review-feedback state before relying on it.
