# Issue tracker: Linear

Issues and PRDs for this repo live in Linear, in the team with identifier prefix `AP-`. Use the Linear MCP tools (`mcp__claude_ai_Linear__*`) for all operations.

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

When sending markdown content (title or description), pass real newlines, not literal `\n` escape sequences.

## When a skill says "publish to the issue tracker"

Create a Linear issue in the AP team via `save_issue`.

## When a skill says "fetch the relevant ticket"

Call `get_issue` with the identifier the user passed (e.g. `AP-12`). Follow up with `list_comments` if conversation history matters.
