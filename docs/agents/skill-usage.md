# Skill Usage

Use the smallest skill that matches the job. Repo-local skills are Claude-first:
`.claude/skills` is the canonical source, and `.agents/skills` contains links
to those Claude skill directories for Codex-style runtimes.

| Task                                                           | Skill                       |
| -------------------------------------------------------------- | --------------------------- |
| Pick up the next repo item and drive it toward a PR            | `workflow-agent-queue`      |
| Keep Linear, worker runs, PR checks, and feedback loops moving | `workflow-agent-queue`      |
| Review new `main` commits and queue actionable fixes in Linear | `workflow-agent-review`     |
| Implement one ready Linear issue                               | `workflow-agent-implement`  |
| Review local changes before PR                                 | `workflow-code-review`      |
| Review one PR against its issue and repo invariants            | `workflow-agent-review`     |
| Generic local diff or PR bug review                            | `workflow-code-review`      |
| Create a PR from an existing branch                            | `workflow-create-pr`        |
| Work on Neon setup or Postgres platform tasks                  | `agent-paste-neon-postgres` |

## Recurring Loops To Run

Run these side by side:

- `workflow-agent-queue` keeps Linear, delegated agents,
  PR checks, and review feedback moving.
- `workflow-agent-review` reviews newly landed `main`
  commits and queues actionable fixes in Linear.

## Runtime Locations

- Claude reads repo-local skills from `.claude/skills`.
- Codex reads repo-local skills through `.agents/skills`, which links back to
  `.claude/skills`.
- Cursor Background Agents should read this file, `.cursor/rules/agent-paste.mdc`,
  and `docs/agents/remote-cursor-agent.md`; they do not need personal global
  skills to follow this workflow.

Do not create runtime-specific copies of the workflow logic. Update
`docs/agents/workflow.md` and the canonical `.claude/skills` files first; keep
`.agents/skills` as links.

## Maintenance Guard

When editing repo-local skills, keep `.claude/skills` canonical and
`.agents/skills` as symlinks to it. Skill layout is validated by the central
skills repository's CI, not by a local guard in `pnpm verify`.

## Status Vocabulary

Use the status meanings from `docs/agents/workflow.md`:

- `Todo`
- `In Progress`
- `Blocked`
- `In Review`
- `Changes Requested`
- `Ready to Merge`
- `Done`
- `Canceled`

When a runtime or Linear workspace lacks one of these states, use the closest
configured state only after saying which mapping is being used.
