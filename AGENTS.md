# agent-paste

## Start here

Read `docs/ops/project-status.md` first. It is the source of truth for what is implemented, what is partial, what is deferred, and the ordered backlog. When asked to "implement the next step," start at the top of the backlog in that file.

Then: `CONTEXT.md` (domain language), `docs/specs/README.md` (spec reading order), `docs/adr/README.md` (ADR index).

## Project stage

Pre-launch. Nothing is deployed; there are no users, tokens, or credentials in the wild. Do not add legacy, deprecated, or back-compat code paths or migration shims. There is nothing to stay compatible with. When behavior needs to change, change it outright.

## Agent skills

### Issue tracker

Linear, team prefix `AP-`. See `docs/agents/issue-tracker.md`.

### Triage labels

Defaults applied as Linear labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout: `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
