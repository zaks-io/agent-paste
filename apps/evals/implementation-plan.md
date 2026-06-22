# Homepage cold-publish eval implementation plan

Date: 2026-06-21

## Done

V1 is done when a human or agent can run one local command with a YAML config
containing any number of OpenRouter models, and the tool:

1. Creates one fresh Docker container per uncached run by default.
2. Starts cached coding-harness infrastructure in each sandbox.
3. Sends the configured copied prompt to the selected harness.
4. Routes Agent Paste publishes to preview through env vars.
5. Verifies each final `unlisted_url` returns HTTP 200 without auth.
6. Stores every transcript, event stream, verifier result, judge result, and
   aggregate report locally.
7. Prints a model-by-model succeeded/failed list.
8. Produces a report suitable for handing to a coding agent to improve docs or
   prompt copy.

## Primary sources

Daytona:

- TypeScript SDK sandbox creation uses `new Daytona()` and `daytona.create(...)`
  with `language`, `envVars`, and snapshots:
  <https://www.daytona.io/docs/en/typescript-sdk/>
- Network limits use `networkAllowList` and `networkBlockAll`; the allow list is
  IPv4 CIDR-only, does not support hostnames/domains, and is limited to 10
  entries:
  <https://www.daytona.io/docs/en/network-limits/>
  The docs list essential services, including package managers and Git hosts,
  as tier-level access, but the allow list itself only accepts CIDR entries.
  Treat Daytona allowlisting as a brittle future provider path for this suite:
  every hostname used by the harness, docs, model provider, npm, and Agent
  Paste may need explicit operational verification before Daytona can be a
  default backend again.
- Snapshot creation and sandbox lifecycle methods live on `Sandbox`, including
  `_experimental_createSnapshot`, `_experimental_fork`, `start`, `stop`, labels,
  auto-stop, auto-delete, and network settings:
  <https://www.daytona.io/docs/en/typescript-sdk/sandbox/>
- Command and session execution support one-shot commands, env vars, timeouts,
  persistent sessions, async logs, and input:
  <https://www.daytona.io/docs/en/process-code-execution/>
- Ephemeral sandboxes can auto-delete when stopped with `ephemeral: true` or
  `autoDeleteInterval: 0`:
  <https://www.daytona.io/docs/en/getting-started/>
- Volumes persist independently of sandbox lifecycle and can share state across
  sandboxes. Do not use volumes for v1 Agent Paste eval runs:
  <https://www.daytona.io/docs/en/volumes/>

Pi:

- Pi is a minimal terminal coding harness and installs as
  `@earendil-works/pi-coding-agent`: <https://pi.dev/docs/latest>
- RPC mode runs as `pi --mode rpc [options]` over stdin/stdout JSONL:
  <https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md>
- OpenRouter credentials use `OPENROUTER_API_KEY`:
  <https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/providers.md>

Claude Code:

- Headless mode supports `claude -p`, `--model`, `--max-turns`,
  `--permission-mode`, and `--output-format stream-json`:
  <https://code.claude.com/docs/en/headless>

Codex:

- Noninteractive execution uses `codex exec`; JSONL output is available through
  `--json`, model selection through `--model`, approval policy through
  `--ask-for-approval`, and final answer capture through `--output-last-message`:
  <https://developers.openai.com/codex/cli/reference>

OpenRouter:

- List models with `GET https://openrouter.ai/api/v1/models`:
  <https://openrouter.ai/docs/api/api-reference/models/get-models>
- List zero-data-retention-capable endpoints with
  `GET https://openrouter.ai/api/v1/endpoints/zdr`:
  <https://openrouter.ai/api/v1/endpoints/zdr>
- Request parameters include `reasoning`, `reasoning_effort`, `verbosity`,
  `response_format`, and `structured_outputs`:
  <https://openrouter.ai/docs/api/reference/parameters>
- Reasoning metadata can appear per model as `reasoning.supported_efforts`,
  `default_effort`, `supports_max_tokens`, and `mandatory`:
  <https://openrouter.ai/docs/guides/best-practices/reasoning-tokens>

AI SDK:

- Structured output uses `generateText` with `Output.object`:
  <https://sdk.vercel.ai/docs/ai-sdk-core/generating-structured-data>
- OpenRouter model calls use the OpenRouter AI SDK provider:
  <https://github.com/openrouterteam/ai-sdk-provider>

Current package versions observed during planning:

- `@daytonaio/sdk`: latest observed `0.189.0`; implementation pinned
  `0.187.0` because the repo's pnpm minimum-release-age policy blocked the
  newest package during installation.
- `@earendil-works/pi-coding-agent`: `0.79.9`
- `@anthropic-ai/claude-code`: `2.1.185`
- `@openai/codex`: `0.141.0`

Current implementation dependencies:

- `ink`: `7.1.0`
- `ai`: `6.0.208`
- `@openrouter/ai-sdk-provider`: `2.9.1`

## Architecture

Build a local CLI app in `apps/evals` with three internal layers:

1. `controller`
   Reads config, loads `.env.local`, expands the run matrix, applies concurrency
   limits, retries infra failures, and writes run directories.

2. `sandbox`
   Provider adapter. Docker is the default practical adapter; Daytona remains
   available behind the same boundary. The adapter creates isolated sandboxes,
   verifies fresh Agent Paste state, runs the selected harness, streams files
   and logs back, and stops or deletes resources according to config.

3. `harness`
   Harness-neutral interface with `pi-rpc`, `claude-code`, and `codex`
   adapters. Pi runs in RPC mode, Claude Code runs in stream JSON print mode,
   and Codex runs through `exec --json`. Codex uses an HTTPS-only custom OpenAI
   provider and bypasses its inner command sandbox when running in Docker,
   because Docker is the isolation boundary for this suite. All adapters write
   JSONL events, transcripts, final answers, and normalized metrics when
   available.

Then run:

1. `verifier`
   Extract URLs, classify them, reject wrong-environment handoff URLs in the
   preview suite, require at least one `unlisted_url`, fetch it without auth,
   scan the fetched artifact for production handoff links, and write the
   artifact snapshot when configured. Only HTTP 200 is deterministic pass
   evidence.

2. `judge`
   AI SDK structured-output LLM call over transcript plus verifier data. Scores
   the run, identifies failure modes, wasted turns, wasted tokens, and concrete
   doc-friction findings.

3. `reporter`
   Aggregates per-run results into a concise model matrix and a handoff report
   for a coding agent.

## Docker plan

Use a local Docker image for the cached harness layer:

```sh
docker build \
  -t agent-paste-evals-agent-runner:0.2.0 \
  -f apps/evals/docker/agent-runner.Dockerfile apps/evals/docker
```

The image installs:

- Node 24
- curl, jq, git, ripgrep, and basic shell tools
- `@earendil-works/pi-coding-agent@0.79.9`
- `@anthropic-ai/claude-code@2.1.185`
- `@openai/codex@0.141.0`

The image must not install Agent Paste or preserve an Agent Paste npm cache.
Each run starts a new named container with fresh values for `HOME`,
`XDG_CONFIG_HOME`, `NPM_CONFIG_CACHE`, `PI_CODING_AGENT_DIR`, and
`PI_CODING_AGENT_SESSION_DIR`, `CODEX_HOME`, and `CLAUDE_CONFIG_DIR`.

The Docker adapter exposes the same process/session API used by the harness
adapters:

1. `docker run -d ... sleep infinity`
2. freshness probe with `docker exec`
3. network probe with `docker exec`
4. run the selected harness command
5. stream stdout/stderr and write prompt input when the harness protocol needs it
6. `docker rm -f` unless `cleanup.mode: keep`

## Daytona plan

Daytona is kept as a future provider, but it is not the default path right now.
Recent testing showed TLS resets from Daytona sandboxes to preview Agent Paste
hosts even after applying Daytona's documented IPv4 CIDR allowlist. That makes
it a bad fit for this feedback loop until the org/network policy is understood.

Use the TypeScript SDK.

Create a runner snapshot manually or through a CLI command:

1. Create a base sandbox.
2. Install Node and common tools if the snapshot image does not already have
   them.
3. Install the harness CLIs globally:

   ```sh
   npm install -g --ignore-scripts @earendil-works/pi-coding-agent @anthropic-ai/claude-code @openai/codex
   ```

4. Verify no Agent Paste package or config exists.
5. Snapshot the sandbox as `agent-paste-evals-agent-runner`.

Run creation should use the snapshot:

```ts
const sandbox = await daytona.create({
  snapshot: config.sandbox.snapshot,
  language: "typescript",
  envVars: runEnv,
  networkAllowList: resolvedNetworkAllowList,
  autoStopInterval: config.sandbox.lifecycle.auto_stop_interval_minutes,
  autoDeleteInterval: config.sandbox.lifecycle.auto_delete_interval_minutes,
});
```

Set labels after create:

```ts
await sandbox.setLabels({
  app: "agent-paste-evals",
  suite: suite.id,
  run_id: run.id,
  model: run.model.id,
});
```

Before starting a harness, execute a freshness probe:

```sh
set -eu
mkdir -p "$HOME" "$XDG_CONFIG_HOME" "$NPM_CONFIG_CACHE"
[ -z "${PI_CODING_AGENT_DIR:-}" ] || mkdir -p "$PI_CODING_AGENT_DIR"
[ -z "${PI_CODING_AGENT_SESSION_DIR:-}" ] || mkdir -p "$PI_CODING_AGENT_SESSION_DIR"
[ -z "${CODEX_HOME:-}" ] || mkdir -p "$CODEX_HOME"
[ -z "${CLAUDE_CONFIG_DIR:-}" ] || mkdir -p "$CLAUDE_CONFIG_DIR"
test ! -e "$XDG_CONFIG_HOME/agent-paste"
test ! -e "$HOME/.config/agent-paste"
! command -v agent-paste
npm cache ls @zaks-io/agent-paste >/tmp/agent-paste-cache.txt 2>&1 || true
! grep -q "@zaks-io/agent-paste" /tmp/agent-paste-cache.txt
```

Then execute a network preflight against the configured probe URLs. This fails
before any model call when Daytona tier policy or allowlist resolution still
blocks Agent Paste docs/API/upload/app access.

For Pi, use a persistent process session because RPC is interactive JSONL:

1. `createSession(runSessionId)`
2. `executeSessionCommand(..., { command: "pi --mode rpc ...", runAsync: true })`
3. stream stdout/stderr with `getSessionCommandLogs`
4. send JSONL input with `sendSessionCommandInput`
5. clean up the session in `finally`

Use Daytona explicit cleanup when available, or ephemeral auto-delete after stop.
V1 can rely on auto-delete, but explicit cleanup should still be best-effort.

## Parallelism and rate limits

Expose separate knobs because the likely bottleneck is OpenRouter, while sandbox
create/run limits differ by provider:

- `matrix.concurrency`: global run concurrency.
- `sandbox.max_concurrent_creates`: concurrent sandbox creates/builds.
- `sandbox.max_concurrent_running`: concurrent active sandboxes.
- `matrix.openrouter.max_concurrent_requests`: concurrent model or judge calls.
- `matrix.openrouter.requests_per_minute`: optional throttle.
- `matrix.openrouter.tokens_per_minute`: optional throttle.

Default concurrency to `1` until real limits are measured. Operators can raise
the sandbox and OpenRouter knobs independently once a suite is stable.

## Model and reasoning config

Fetch OpenRouter models at run start unless disabled:

```sh
curl -fsSL https://openrouter.ai/api/v1/models
```

Use it to:

- verify every configured model ID exists;
- record name, context length, pricing, supported params, and reasoning metadata;
- preflight enabled models that request `provider.zdr: true` against the
  OpenRouter ZDR endpoint list before any sandbox starts;
- resolve helper aliases like `latest-opus`, `latest-sonnet`, and `gpt-5.5` only
  when a command explicitly asks for refresh or resolution.

Current baseline IDs verified on 2026-06-21:

- `anthropic/claude-opus-4.8`
- `anthropic/claude-sonnet-4.6`
- `openai/gpt-5.5`

The config stores:

- `effort_label` for reporting and matrix names.
- raw `provider_params` for OpenRouter.
- Pi-level thinking where Pi supports it.

Pi supports `off`, `minimal`, `low`, `medium`, `high`, and `xhigh` in RPC
`set_thinking_level`. OpenRouter supports `reasoning_effort` values `none`,
`minimal`, `low`, `medium`, `high`, and `xhigh`; model metadata may narrow that
set.

Rules:

- Do not invent a universal reasoning translation.
- Validate configured OpenRouter params against `supported_parameters` when the
  model metadata exposes them.
- Record unsupported params as config errors unless `allow_unsupported_params`
  is set.
- Record both requested config and effective Pi/OpenRouter config in results.

Observed model metadata on 2026-06-21:

- `openai/gpt-5.5` supports efforts `xhigh`, `high`, `medium`, `low`, `none`;
  default effort is `medium`.
- `anthropic/claude-opus-4.8` exposes `reasoning` and `verbosity`, but no
  explicit `supported_efforts` list.
- `anthropic/claude-sonnet-4.6` exposes `reasoning` and `verbosity`, but no
  explicit `supported_efforts` list.

## Prompt config

Use raw YAML input for v1. Do not crawl apex.

The controller can append a generated or fixed claim code suffix so prompt
variants remain easy to edit:

```yaml
prompt:
  source: static
  text: "Read https://preview.agent-paste.sh/agents.md..."
  claim_code:
    mode: generate
```

The run result records the exact prompt sent and the claim code mode.

## Verification

Keep deterministic verification narrow:

- Extract URLs from final answer and transcript.
- Classify Agent Paste URL types.
- Require a preview `unlisted_url`.
- Fail wrong-environment production handoff URLs when
  `reject_production_urls` is true.
- Keep production docs and example URLs informational.
- Fetch the `unlisted_url` without auth.
- Pass deterministic verification only on HTTP 200.

No keyword checks. No subjective artifact-quality checks in the verifier.

## Judge

Use structured output with a JSON schema. Inputs:

- resolved config summary;
- exact prompt;
- normalized event stream;
- Pi stats;
- verifier result;
- final answer;
- full transcript when under budget.

If the transcript exceeds `judge.max_transcript_chars`, truncate, add
`transcript_too_large`, and fail the run for this suite. The suite is supposed to
be a short loop.

The judge should output:

- numeric rubric scores;
- pass/fail opinion separate from deterministic verifier;
- wasted turns and wasted tokens estimate;
- friction findings with evidence;
- suggested docs or prompt targets;
- concise handoff summary.

## Retry policy

Retry infra errors three times:

- Docker image build/container start errors.
- Daytona create/start/session errors when using the Daytona provider.
- Harness startup failures.
- OpenRouter transient 429/5xx/network errors.
- Preview verifier fetch 429/5xx/network errors.
- Judge 429/5xx/network errors.

Do not retry model behavior failures, bad final answers, wrong URL type, or HTTP
4xx from an otherwise reachable `unlisted_url`.

## Secrets

Load secrets from `apps/evals/.env.local` by default:

```sh
OPENROUTER_API_KEY=...
ANTHROPIC_API_KEY=...
OPENAI_API_KEY=...
# Required only for Daytona configs:
DAYTONA_API_KEY=...
```

The run environment passes OpenRouter keys to Pi and the judge, Anthropic keys to
Claude Code, and OpenAI keys to Codex. Daytona keys are passed only when the
selected provider is Daytona. Result artifacts are local development artifacts,
so v1 only redacts provider secrets in human-readable reports. Secret-looking
transcript output is not verifier or judge friction by itself.

## CLI shape

Initial commands:

```sh
pnpm --filter @agent-paste/evals evals run --config apps/evals/config.example.yaml
pnpm --filter @agent-paste/evals evals report <result-dir>
pnpm --filter @agent-paste/evals evals models refresh
pnpm --filter @agent-paste/evals evals env copy
pnpm --filter @agent-paste/evals evals snapshot create
```

`run` is resumable by default. Use `--fresh` only when the existing results
should be ignored and a new cold execution should spend sandbox/model time.

The first useful command can be shorter once package scripts exist:

```sh
pnpm evals:run --config apps/evals/config.example.yaml
pnpm evals:env
```

## V1 build order

1. Scaffold `@agent-paste/evals` package and config loader.
2. Add OpenRouter model metadata fetch and validation.
3. Add sandbox provider boundary with Docker and Daytona adapters.
4. Add harness adapters with event capture.
5. Add prompt matrix expansion and concurrency controls.
6. Add URL extractor and HTTP 200 verifier.
7. Add AI SDK structured judge call.
8. Add local result writer.
9. Add aggregate report.
10. Run one model once against preview, then expand to the three-model baseline.
