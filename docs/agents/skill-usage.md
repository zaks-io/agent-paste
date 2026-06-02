# Skill Usage

Use the smallest skill that matches the job. Repo-local skills are Claude-first:
`.claude/skills` is the canonical source, and `.agents/skills` contains links
to those Claude skill directories for Codex-style runtimes.

| Task                                                           | Skill                       |
| -------------------------------------------------------------- | --------------------------- |
| Orchestrate a ticket set, filter, or backlog-until-clear run   | `ziw-orchestrate`           |
| Review new `main` commits and queue actionable fixes in Linear | `ziw-review`                |
| Implement one ready Linear issue                               | `ziw-implement`             |
| Review local changes before PR                                 | `ziw-code-review`           |
| Review one PR against its issue and repo invariants            | `ziw-review`                |
| Generic local diff or PR bug review                            | `ziw-code-review`           |
| Create a PR from an existing branch                            | `ziw-pr`                    |
| Turn a spec, PRD, or epic into dependency-ordered tickets      | `ziw-to-issues`             |
| Triage and reconcile tracker issues, make tickets agent-ready  | `ziw-triage`                |
| Set up or refresh a repo for agent workflows                   | `ziw-setup`                 |
| Work on Neon setup or Postgres platform tasks                  | `agent-paste-neon-postgres` |

## Recurring Loops To Run

Run these side by side:

- `ziw-orchestrate` keeps Linear, delegated agents,
  PR checks, and review feedback moving.
- `ziw-review` reviews newly landed `main`
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
