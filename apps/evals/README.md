# Agent Paste evals

This app owns development-time evaluation harnesses for agent onboarding flows.
The first suite is the homepage cold-publish prompt: a user copies the prompt
from the apex homepage into a coding agent, the agent installs Agent Paste cold,
publishes to preview through the accountless path, and returns a working
no-login link.

These evals are not product runtime. They are local operator tooling for finding
model failure modes, wasted turns, doc friction, and prompt regressions before
copy or docs changes ship.

## Current scope

- Run against preview by default.
- Use fresh local Docker containers per uncached run by default.
- Keep Daytona as a configurable future sandbox provider.
- Cache only the generic harness layer, not Agent Paste install state.
- Drive Pi through RPC mode as the first coding harness.
- Use OpenRouter model IDs and provider-native reasoning config.
- Preflight OpenRouter ZDR endpoint availability for enabled ZDR-required
  models.
- Use AI SDK structured output for the judge LLM.
- Store all run data locally in a structured results directory.
- Produce reviewable doc-friction findings for a coding agent or human to fix.

## Quick start

Create the local env file:

```sh
pnpm evals:env
```

Run a no-cost config and DX check:

```sh
pnpm evals:run -- --dry-run --no-judge
```

Run the configured suite:

```sh
pnpm evals:run
```

The first live run builds `agent-paste-evals-pi-runner:0.1.0` from
`apps/evals/docker/pi-runner.Dockerfile`. That image caches Pi and generic
runner tools only; each run still gets a new container and fresh Agent Paste
install/cache paths.

The `run` command is resumable by default. Repeating the same command reuses
existing results and does not relaunch expensive runs. Use `--fresh` to force a
new cold execution.

Other commands:

```sh
pnpm evals -- models refresh --output /tmp/openrouter-models.json
pnpm evals -- env copy --dry-run
pnpm evals -- report <result-dir>
pnpm evals -- snapshot create --dry-run
```

To try Daytona later, run with `--config apps/evals/config.daytona.example.yaml`.

Results are written under `eval-results/` by default. Use `--output <dir>` on
`run` to write elsewhere. Each result directory includes:

- `summary.md`: clean operator view of final outcomes, costs, tokens, and top
  friction.
- `aggregate.md`: detailed self-contained handoff for a remote coding agent.
- `run.json` and `runs/*/result.json`: structured data for scripts.

Verifier output separates preview-host mistakes from normal docs access:
production docs URLs are informational, wrong production handoff URLs fail, and
production links or secret-looking values inside the fetched artifact become
warnings.

## Out of scope for v1

- Authenticated/login flows.
- Production publishes.
- Automatic documentation patches.
- Long-term result storage.
- A hosted dashboard or control plane.
- Test-account provisioning.

## Documents

- [Decisions](./decisions.md) records the design choices made before
  implementation.
- [Implementation plan](./implementation-plan.md) turns those decisions into the
  first build plan, with source links for Daytona, Pi, and OpenRouter.
- [Config sketch](./config.example.yaml) shows the intended configurable shape.
