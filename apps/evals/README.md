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
- Treat `/workspace` as an empty scratch directory unless a test explicitly
  mounts source files.
- Drive Pi through RPC mode by default.
- Support Claude Code stream JSON and Codex `exec --json` as opt-in harnesses.
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

Run the configured prompt against every enabled model in the main matrix:

```sh
pnpm evals:run -- --fresh
```

Run the same prompt against opt-in harnesses:

```sh
pnpm evals:run -- --harnesses claude-code,codex --models anthropic/claude-sonnet-4.6,openai/gpt-5.5-low
```

The first live run builds `agent-paste-evals-agent-runner:0.2.0` from
`apps/evals/docker/agent-runner.Dockerfile`. That image caches Pi, Claude Code,
Codex, and generic runner tools only; each run still gets a new container and
fresh Agent Paste install/cache paths.

Pi is the only enabled harness in the default matrix. Claude Code and Codex are
present in `config.example.yaml` with `enabled: false`; explicitly selecting a
harness runs it even when disabled in the default matrix:

```sh
pnpm evals:run -- --harness claude-code --models anthropic/claude-sonnet-4.6
pnpm evals:run -- --harness codex --models openai/gpt-5.5-low,openai/gpt-5.5-xhigh
```

Model IDs can be translated per harness with `harness_model_ids`. For example,
Pi can use `openai/gpt-5.5` through OpenRouter while Codex receives `gpt-5.5`,
and Pi can use `anthropic/claude-sonnet-4.6` while Claude Code receives
`sonnet`. Use `supported_harnesses` to keep incompatible model/harness pairs out
of the run matrix.

The Codex harness defaults are tuned for nested Docker isolation:

- `bypass_sandbox: true` disables Codex's inner `bwrap` sandbox, which does not
  work in the eval Docker container without privileged user namespaces.
- `config_overrides.model_provider: openai_http` uses the OpenAI API key over
  HTTPS with `supports_websockets: false`; this avoids the unauthenticated
  websocket path observed in Codex CLI `0.141.0`.

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
production docs and example URLs are informational, wrong production handoff
URLs fail, and production handoff links or secret-looking values inside the
fetched artifact become warnings.

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
  first build plan, with source links for Daytona, Pi, Claude Code, Codex, and
  OpenRouter.
- [Config sketch](./config.example.yaml) shows the intended configurable shape.
