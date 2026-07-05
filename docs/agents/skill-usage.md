# Skill Usage

Use the smallest skill that matches the job. Repo-local workflow skills are
synced from upstream. In this checkout, `.agents/skills/ziw-*` are the tracked
skill directories and `.claude/skills/ziw-*` are symlinks back to them. Do not
hand-edit synced `ziw-*` skills here; record needed changes in AP-98 as
config-gap metadata.

| Task                                                           | Skill                           |
| -------------------------------------------------------------- | ------------------------------- |
| Orchestrate a ticket set, filter, or backlog-until-clear run   | `ziw-orchestrate`               |
| Review new `main` commits and queue actionable fixes in Linear | `ziw-code-review` (independent) |
| Implement one ready Linear issue                               | `ziw-implement`                 |
| Review local changes before PR                                 | `ziw-code-review`               |
| Review one PR against its issue and repo invariants            | `ziw-code-review` (independent) |
| Generic local diff or PR bug review                            | `ziw-code-review`               |
| Create a PR from an existing branch                            | `ziw-pr`                        |
| Turn a spec, PRD, or epic into dependency-ordered tickets      | `ziw-to-issues`                 |
| Triage and reconcile tracker issues, make tickets agent-ready  | `ziw-triage`                    |
| Set up or refresh a repo for agent workflows                   | `ziw-setup`                     |
| Work on Neon setup or Postgres platform tasks                  | `agent-paste-neon-postgres`     |

## Recurring Loops To Run

Run these side by side:

- `ziw-orchestrate` keeps Linear, delegated agents,
  PR checks, and review feedback moving.
- `ziw-code-review` independent mode reviews newly landed `main`
  commits and queues actionable fixes in Linear.

## Runtime Locations

- Claude reads repo-local skills from `.claude/skills`.
- Codex reads repo-local skills through `.agents/skills`.
- The two runtime paths must resolve to the same files. In this checkout,
  `.claude/skills/ziw-*` symlink to `.agents/skills/ziw-*`; if a runtime cannot
  follow symlinks, read `.agents/skills/<name>` directly.
- Cursor Background Agents should read this file, `.cursor/rules/agent-paste.mdc`,
  and `docs/agents/remote-cursor-agent.md`; they do not need personal global
  skills to follow this workflow.

Do not create runtime-specific copies of the workflow logic. Update
`docs/agents/workflow.md` first. Do not update synced `ziw-*` skills locally.

## Maintenance Guard

Do not edit synced `ziw-*` skills in this repo. They are refreshed from the
upstream skills repository, and local edits will be overwritten. If a skill
needs to change, log the requested upstream fix in AP-98 with category
`config-gap`.

## Status Vocabulary

Use the status meanings from `docs/agents/workflow.md`:

- `Todo`
- `Triage`
- `Backlog`
- `In Progress`
- `Blocked`
- `In Review`
- `Changes Requested`
- `Ready to Merge`
- `Done`
- `Canceled`
- `Duplicate`

When a runtime or Linear workspace lacks one of these states, use the closest
configured state only after saying which mapping is being used.
