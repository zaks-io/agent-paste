# Issue Tracker: Linear

Issues and PRDs for this repo live in Linear, in the team with identifier
prefix `AP-`. Use the Linear tools available in the current runtime for all
operations.

## Team

- **Identifier prefix**: `AP-` (e.g. `AP-12`, `AP-47`)
- Look up the team object with `list_teams` or `get_team` if you need a `teamId` for create operations.
- **Roadmap project**: `agent-paste Roadmap`

## Milestones

Use execution-wave milestones for roadmap tracking:

1. `Wave 0 - Agent Handoff Ready`
2. `Wave 1 - Operator And Ops Hardening`
3. `Wave 2 - Access Links And Artifact Lifecycle`
4. `Wave 3 - Live Updates`
5. `Wave 4 - MCP`
6. `Wave 5 - Platform Hardening`
7. `Wave 6 - Monetization`
8. `Wave 7 - Cleanup And Deferred Polish`

`ready-for-agent` means a ticket is detailed enough for an unattended remote
agent. Apply `remote-cursor` only when the issue is intended for Cursor
Background Agent implementation after it becomes `ready-for-agent`.

## Conventions

- **Create an issue**: `save_issue` with a `teamId` resolved from the AP team. Set `title`, `description` (markdown), and `labelIds` for triage labels.
- **Read an issue**: `get_issue` with the identifier (e.g. `AP-12`). Use `list_comments` for conversation history.
- **List issues**: `list_issues` filtered by `teamId` and optionally by label or state.
- **Comment on an issue**: `save_comment` with the issue's id and the body markdown.
- **Apply / remove labels**: `save_issue` with the updated `labelIds` array (Linear replaces the full set). Resolve label ids with `list_issue_labels` once per session and cache.
- **Close**: `save_issue` setting the issue's state to a canceled or done workflow state.
- **Handoff after agent PR**: when a remote agent opens a ready-for-review PR for
  the issue, move the issue to **In Review** with `save_issue`. Rely on the
  GitHub integration for the PR link; do not comment on the issue only to paste
  the URL.
- **Changes requested**: when PR review finds actionable feedback, move the
  issue to **Changes Requested** when that state exists. Route feedback back to
  the original implementation worker so it continues on the same branch and PR.
  If the state does not exist yet, leave the issue in **In Review**, add a
  comment with the requested changes, and ask the human operator to map or add
  the state.
- **Ready to merge**: move to **Ready to Merge** only after required checks pass
  and the PR review gate is clean.

When sending markdown content (title or description), pass real newlines, not literal `\n` escape sequences.

## Workflow States

The shared state contract lives in `docs/agents/workflow.md` and
`docs/agents/autonomous-loop.md`.

Use these state meanings:

| State               | Meaning                                                         |
| ------------------- | --------------------------------------------------------------- |
| `Todo`              | Ready queue or backlog.                                         |
| `In Progress`       | Active implementation.                                          |
| `Blocked`           | Cannot continue until a blocker is resolved.                    |
| `In Review`         | PR is open and ready for review.                                |
| `Changes Requested` | PR has actionable feedback; continue on the same branch and PR. |
| `Ready to Merge`    | Required checks and review are clean.                           |
| `Done`              | Completed.                                                      |
| `Canceled`          | Closed without completion.                                      |

## When a skill says "publish to the issue tracker"

Create a Linear issue in the AP team via `save_issue`.

## When a skill says "fetch the relevant ticket"

Call `get_issue` with the identifier the user passed (e.g. `AP-12`). Follow up with `list_comments` if conversation history matters.
