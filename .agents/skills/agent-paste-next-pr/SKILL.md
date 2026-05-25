---
name: agent-paste-next-pr
description: Drives the agent-paste next-work-to-PR loop from project status through a delegated worktree implementation, PR creation, CI watching, and CodeRabbit follow-up. Use when the user asks to implement the next step, pick up the next bit of work, run the project backlog, open a PR from the active phase, use Codex or Claude Code as a worker, or handle CodeRabbit feedback for agent-paste.
---

# Agent Paste Next PR

Use this repo-specific coordinator workflow. `agent-paste` is pre-launch:
change behavior outright instead of adding legacy compatibility.

## Quick Start

From `/Users/isaacsuttell/src/agent-paste`, read `AGENTS.md`,
`docs/ops/project-status.md`, `docs/ops/status/phase-backlog.md`,
`CONTEXT.md`, `docs/specs/README.md`, and `docs/adr/README.md`.

Pick the first unchecked item in the active phase unless the user names a
different target. If the item is blocked, record the exact blocker and move on
only when backlog text or user instruction allows it.

## Loop Mode

When asked to run in a loop, process one implementation PR at a time. Start each
iteration by fetching latest `main` and rereading status/backlog docs. Continue
only after the prior PR is merged, or after the user explicitly says to stack
another PR. Stop on blocked or ambiguous backlog items, failing checks that need
external access, unresolved CodeRabbit disagreement, merge conflicts, or the
user's loop budget. After merge, delete the worktree/branch if safe, fetch,
rebase from latest base, and choose the new first unchecked active item.

## Workflow

1. Confirm target scope.
   - Restate the selected backlog item and why it is next.
   - Read linked spec, ADR, and runbook context for that area only.
   - Check `git status --short`; preserve user changes.
2. Create an isolated implementation worktree on the latest base.
   - Prefer the `implement-feature-pr` skill if available.
   - Run `git fetch --prune origin` first. Create new branches from the fetched
     default branch, usually `origin/main`.
   - If resuming, rebase the worktree branch onto the fetched default branch
     before implementation starts. If that conflicts before new work has begun,
     abort the rebase and recreate the worktree from latest base.
   - Keep the parent agent as coordinator and spawn exactly one worker in that
     worktree.
3. Delegate implementation.
   - Use Codex subagents or Claude Code. For Claude Code, run it from the
     prepared worktree with the prompt below; do not use Claude's `--worktree`.
   - Include the selected backlog item, relevant doc paths, worktree path,
     branch, verification expectations, and "do not create another worktree."
   - Require a final worker report with changed files, checks run, blockers,
     and dirty or clean state.
4. Coordinator review.
   - Inspect status and diff in the worker worktree.
   - Run targeted checks during review, then run `pnpm verify` before PR unless
     clearly infeasible.
   - Update status, backlog, and coverage docs when the completed item requires
     it; do not mark unrelated future items.
5. Run exactly one local CodeRabbit pass, then open the PR.
   - If installed and authenticated, run
     `coderabbit review --agent --base <base>` one time before the PR.
   - Fix clear actionable findings from that run, but do not rerun CodeRabbit
     locally. Let all later review iterations happen on the PR.
   - Use `create-pr` for PR conventions if helpful, but override its local
     CodeRabbit loop with this skill's one-run policy. Prefer `pnpm verify`
     over generic `bun` checks.
   - Stage named files only, commit with Conventional Commits, push the branch,
     and create the PR with Summary, Changes, Risk, and Test plan.
6. Watch the PR process and resolve CodeRabbit.
   - Use `gh pr checks <pr> --watch --fail-fast --interval 15` for PR checks.
   - Use `gh pr view <pr> --json url,reviewDecision,latestReviews,comments,statusCheckRollup,mergeStateStatus`
     and `gh pr view <pr> --comments` for review state and top-level comments.
   - Use `gh run list --branch <branch> --json databaseId,name,status,conclusion,url`
     and `gh run watch <run-id> --compact --exit-status` for a specific Action.
   - Use `gh-address-comments` for unresolved review threads when available.
   - Fix actionable items in the same worktree, rerun relevant checks, commit,
     push, and wait again.
   - Stop only when CodeRabbit approves, has no actionable findings, or a
     concrete blocker needs the user.

## Subagent Prompt Template

```text
Implement the next agent-paste backlog item in this existing worktree.

Worktree: <WORKTREE_PATH>
Branch: <BRANCH_NAME>
Backlog item: <phase-backlog item text>

Read AGENTS.md, project status, phase backlog, CONTEXT.md, specs index, and ADR
index first, then only linked docs needed for this item. Implement directly in
this worktree; do not create another worktree or revert unrelated edits. Run
relevant checks and `pnpm verify` unless you explain a narrower gate. Final
report: changed files, check results, blockers, and dirty/clean state.
```

## Completion

Final response must include PR URL, branch, worktree path, selected backlog item,
verification commands/results, CodeRabbit status, and loop status.
