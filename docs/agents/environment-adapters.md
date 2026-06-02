# Environment Adapters

The shared workflow lives in `docs/agents/workflow.md`. This file only explains
which runtime to choose and what each runtime must read.

## Codex

Use Codex for local queue-moving orchestration, repo-wide edits, verification,
PR creation, Linear maintenance, periodic main review that queues fixes, and
review loops that need access to local worktrees.

Codex should read:

- `AGENTS.md`
- `docs/ops/project-status.md`
- `docs/agents/workflow.md`
- `docs/agents/repo-navigation.md`
- `docs/agents/skill-usage.md`
- the specific skill for the task

## Claude

Use Claude for planning, documentation, second-pass review, or implementation
when the user explicitly chooses it. Claude should use the canonical skills
under `.claude/skills`, not personal global skills.

Claude should read the same shared workflow docs as Codex and any issue-linked
specs, ADRs, or runbooks before editing.

## Cursor

Use Cursor Background Agents for isolated remote implementation where the issue
is already `Todo` + `ready-for-agent`, and labeled `remote-cursor`.

Cursor Composer 2.5 is the preferred workhorse for implementation-heavy,
well-scoped tickets that can be verified locally or in CI. Preserve the original
Cursor thread for review fixes.

Cursor agents should:

- read `.cursor/rules/agent-paste.mdc`, `docs/agents/remote-cursor-agent.md`,
  and `docs/agents/repo-navigation.md`
- implement one Linear issue per branch and PR
- resume the same thread, branch, and PR when the orchestrator sends
  `Changes Requested` feedback
- run or request `ziw-code-review` before PR handoff
- stop on missing product, security, credential, provider, or ADR decisions

## Runtime Selection Hints

Use Cursor when the issue is isolated, well specified, implementation-heavy, and
CI-verifiable.

Use Codex when the task needs local verification, repo-wide cleanup, Linear
state management, PR watching, periodic main review, or queue-loop maintenance.

Use Claude when the task is mostly planning, documentation, or independent
review and the user wants that runtime.
