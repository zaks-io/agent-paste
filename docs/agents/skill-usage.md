# Skill Usage

Use the smallest skill that matches the job. Repo-local skills are Claude-first:
`.claude/skills` is the canonical source, and `.agents/skills` contains links
to those Claude skill directories for Codex-style runtimes.

| Task                                                                   | Skill                           |
| ---------------------------------------------------------------------- | ------------------------------- |
| Pick up the next repo item and drive it toward a PR                    | `agent-paste-next-pr`           |
| Coordinate multiple issues, worker runs, PR checks, and feedback loops | `agent-paste-orchestrator`      |
| Implement one ready Linear issue                                       | `agent-paste-implement-issue`   |
| Review local changes before PR                                         | `agent-paste-local-code-review` |
| Review one PR against its issue and repo invariants                    | `agent-paste-review-pr`         |
| Generic local diff or PR bug review                                    | `agent-paste-code-review`       |
| Create a PR from an existing branch                                    | `agent-paste-create-pr`         |
| Work on Neon setup or Postgres platform tasks                          | `agent-paste-neon-postgres`     |

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

Run `pnpm agent-skills:check` after editing repo-local skills. It verifies that
`.claude/skills` stays canonical, `.agents/skills` stays symlink-only, skill
names stay `agent-paste-*`, UI prompts reference the matching skill name, and
`skills-lock.json` points at canonical `.claude/skills` paths. `pnpm verify`
runs this guard after markdown formatting.

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
