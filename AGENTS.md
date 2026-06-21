# agent-paste

## Start here

Read `docs/ops/project-status.md` first. It is the status entrypoint and links to the detailed ledgers. When asked to "implement the next step," follow its link to `docs/ops/status/phase-backlog.md` and start at the top of the active phase.

Then: `CONTEXT.md` (domain language), `docs/specs/README.md` (spec reading order), `docs/adr/README.md` (ADR index).

**Specs are the current truth; ADRs are the decision trail.** When you need to know how the system behaves now — whether something is enforced, what a table holds, what a route does — read `docs/specs/`. The spec is the consolidated answer so you never have to read N ADRs to reconstruct the latest decision. ADRs record _why_ a decision was made; their conclusions should already be folded into the relevant spec. If a spec and an ADR conflict, the spec wins — but flag the conflict to a human, because it usually means the spec went stale and needs updating. Do not assert "the system doesn't do X" or "X isn't enforced" from an ADR (or from a Drizzle `schema.ts` read) without checking the spec first.

**Flag doc friction; fix the root cause.** When a doc is wrong, misleading, out of date, or missing — or when you hit the same friction a doc should have prevented — surface it to a human and propose the doc or process fix in the same turn. Do not silently work around a bad doc and move on; the workaround leaves the next agent to hit the same wall. The fix to the documentation is part of the task, not a separate chore.

If you need to get oriented or find the owner of a workflow quickly, use
`docs/agents/repo-navigation.md`.

## Project stage

Live production / early alpha. The hosted service and public repository are live,
but the product surface is still intentionally small and may change quickly. Do
not modify production without explicit approval. Public users, published
Artifacts, MCP connections, and npm installs may exist; preserve supported
behavior or make breaking changes explicit in specs, docs, and
migration/operational notes. Do not add legacy or deprecated code paths unless
they are required to preserve a current public contract.

## Testing

Do not write tests that purely assert copy, prose, or prompt wording. Copy is
intentionally edited often, and copy-only tests are brittle noise. Test behavior,
structure, contracts, generated data, legal/security invariants, content types,
routes, and stable attributes instead. If copy needs evaluation, use the eval
harness or human review rather than pinning sentences in unit tests.

## Agent publish surfaces

Tell agents to use the CLI when they can run commands, and MCP when they are in
a hosted tool that can connect to remote MCP but cannot run the CLI. Do not
recommend any other publish surface for agent workflows.

Agent CLI flow:

```sh
agent-paste whoami --json
agent-paste login   # only when whoami shows no active login and interactive auth is possible
agent-paste publish <path>
```

Use `agent-paste publish <path> --ephemeral` only when no login is available and
interactive auth is not possible, or when the user explicitly asks for
accountless publish. For ephemeral output, hand the human `unlisted_url` for
immediate no-login viewing and `claim_url` only for the optional keep/upgrade
step.

## Agent skills

### Workflow

Read `docs/agents/workflow/config.md` before using the `ziw-*` skills
(`ziw-orchestrate`, `ziw-implement`, `ziw-review`, `ziw-code-review`, `ziw-pr`,
`ziw-triage`, `ziw-to-issues`, `ziw-setup`); it is
the metadata index for commands, tracker states, and safety rules.
Shared workflow docs live in `docs/agents/workflow.md`.
Use `docs/agents/skill-usage.md` to choose the smallest repo-local skill for a
task. Use `docs/agents/autonomous-loop.md` for the detailed Linear state
contract and queue-moving/worker loop. Use `docs/agents/repo-navigation.md`
for the repo map and common lookup paths.

**Never edit the `ziw-*` skills (`.agents/skills/ziw-*`) in this repo.** They are
synced in from the upstream `zaks-io/skills` repo (see AP-298), so any local edit
is silently overwritten on the next refresh and your change is lost. Do not
rewrite, hand-patch, or "fix" a skill here. If a skill needs to change, record the
needed change as a metadata-only note in the **AP-98 orchestrator friction log**
(`category: config-gap`, with the target skill named); the skills agent reviews
that log and applies fixes upstream. The same rule applies to any other
synced-in skill, not just `ziw-*`.

### Issue tracker

Linear, team prefix `AP-`. See `docs/agents/issue-tracker.md`.

### Triage labels

Defaults applied as Linear labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout: `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Remote Cursor agents

Remote Cursor agents are unattended Cursor Background Agents for implementing
delegated Linear issues in isolation.

Remote Cursor agents should read `docs/agents/remote-cursor-agent.md` after this
file. Only delegate issues labeled both `ready-for-agent` and `remote-cursor`.
Review fixes should return to the original Cursor thread, branch, and PR when
possible.
