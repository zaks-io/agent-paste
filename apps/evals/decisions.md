# Homepage cold-publish eval decisions

Date: 2026-06-21

## Goal

Evaluate whether the homepage copied prompt works when pasted into different
coding-agent/model combinations. The eval should reveal hard failures and the
friction that causes wasted turns, wasted tokens, or user-visible confusion.

The feedback loop is:

1. Run models through a consistent coding harness in isolated sandboxes.
2. Verify the resulting Agent Paste link deterministically.
3. Judge transcripts for efficiency and friction.
4. Aggregate repeat findings into reviewable doc or prompt improvement work.

## User scenario

The user has already copied the homepage prompt and pasted it into a coding
agent. The agent should read the public Agent Paste agent docs, create a
shareable HTML page, publish it with Agent Paste, and hand back the link.

The v1 suite is cold and accountless only. No login and no test accounts.

## Pass/fail oracle

Live verification owns pass/fail. The model's final text is not enough.

A run passes when:

- The agent performs a cold Agent Paste install or one-shot `npx` use.
- The publish targets preview.
- A working `unlisted_url` is extracted.
- The `unlisted_url` opens without auth.
- The model explicitly hands the user the working `unlisted_url` in its final
  answer.

A run fails when:

- No working `unlisted_url` is produced.
- The model fabricates a link.
- The model only uses authenticated/private flow.
- The model hands off a production Agent Paste app URL during a preview eval.
- The model never installs or runs Agent Paste.
- The run times out before a verifiable link exists.

Scored warnings include:

- Dropped `--claim-code` attribution.
- Production Agent Paste app/API/content links inside the generated artifact.
- `claim_url` presented too prominently.
- Unnecessary login or account confusion that the model recovers from.
- Avoidable doc searching, package-name searching, or command probing.
- Final answer omits useful context even though the link works.

## Environment

The eval must not modify production. Preview is the default target.

Set preview overrides in the sandbox environment:

```sh
AGENT_PASTE_API_URL=https://api.preview.agent-paste.sh
AGENT_PASTE_UPLOAD_URL=https://upload.preview.agent-paste.sh
AGENT_PASTE_WEB_URL=https://app.preview.agent-paste.sh
```

The copied prompt should not mention preview. The prompt stays representative of
the real homepage user path, while environment variables route the CLI to
preview. The verifier fails production handoff URLs, records production docs
links as informational, and warns when the generated artifact contains
production Agent Paste links.

## Prompt source

The primary input is the raw copied homepage prompt stored in YAML. It includes
the base prompt text and, when enabled, the appended attribution instruction:

```text
This eval runs against the configured preview Agent Paste environment. Use the
AGENT_PASTE_* environment variables that are already set. Do not publish to
production. If login is unavailable or non-interactive, publish with
--ephemeral. Include this attribution flag only on the publish command, not
inside the public artifact: --claim-code <clm_...>.
```

Printing environment values, claim tokens, claim URLs, raw publish JSON, or API
keys is not friction for this development suite unless it directly causes task
failure, wrong attribution, a wrong handoff URL, or user-facing confusion.

The run config should support swapping prompt variants by editing config:

- Static prompt text for repeatable development.
- Claim code modes: `generate`, `fixed`, and `none`.

For v1, the controller may generate a valid claim code using the same public
shape as apex: `clm_` plus 26 Crockford characters. Dropping the claim code is a
warning, not a hard failure, because the user-facing link can still work.

Do not crawl apex or rebuild the prompt from `apps/apex` in v1. Raw YAML input is
intentional because copy iteration should be cheap.

## Sandbox isolation

Each model run gets a fresh sandbox. The default provider is now local Docker
because Daytona egress is not reliable enough for the preview-hosted Agent Paste
flow today. Daytona remains behind the same provider boundary for future use.

Docker containers provide a fresh filesystem, process tree, network namespace,
and runtime env per run. Docker image layers intentionally carry only generic
runner state, so the eval must control what is cached.

Allowed cached runner layer:

- Node and system tools needed by the harness.
- Pi coding agent.
- Claude Code CLI.
- Codex CLI.
- Eval controller and verifier utilities.
- Optional verifier tools such as curl, jq, and browser tooling.

Not allowed in the cached runner layer:

- `@zaks-io/agent-paste`.
- npm cache entries for Agent Paste.
- Agent Paste CLI config, auth, keyring, or prior output.
- Prior workspace files or run artifacts.
- Shared model session state.

Each run should set fresh values for:

- `HOME`
- `XDG_CONFIG_HOME`
- `NPM_CONFIG_CACHE`
- `PI_CODING_AGENT_DIR`
- `PI_CODING_AGENT_SESSION_DIR`
- `CODEX_HOME`
- `CLAUDE_CONFIG_DIR`

Pi bootstrap time is harness infrastructure and should not count against the
model. Agent Paste install time does count because this suite tests onboarding.

The controller must also verify the fresh-install invariant inside each run
before the prompt starts:

- `npm cache ls @zaks-io/agent-paste` or equivalent should be empty.
- `command -v agent-paste` should not find a preinstalled binary unless config
  explicitly allows it.
- Agent Paste config paths under the fresh `HOME` and `XDG_CONFIG_HOME` should
  not exist.

Daytona note: network allowlists are CIDR-based, not hostname-based. Per Daytona's
Network Limits docs, `networkAllowList` accepts only IPv4 CIDR entries,
hostnames/domains are not supported, and the allowlist is capped at 10 entries.
The Daytona config stores `sandbox.network.allow_domains` for operator
ergonomics, but the controller resolves those domains to `/32` IPv4 CIDRs before
calling `daytona.create`.

The v1 Agent Paste eval allowlists:

- `agent-paste.sh` for `/agents.md`;
- `api.preview.agent-paste.sh`;
- `upload.preview.agent-paste.sh`;
- `app.preview.agent-paste.sh`.

It also allowlists the sandbox DNS resolvers observed in Daytona
(`/etc/resolv.conf`) so hostname-based agent commands can resolve the allowed
domains: `1.1.1.1/32`, `1.0.0.1/32`, `8.8.8.8/32`, and `100.64.128.1/32`.

Every sandbox performs a network preflight against docs/API/upload/app probe
URLs before the harness starts. If the sandbox provider blocks those hosts, the
run fails fast as infrastructure setup instead of spending model tokens.

## Harness architecture

Pi is the default v1 harness. Claude Code and Codex are supported as opt-in
harnesses through the same adapter boundary so the eval can compare coding
agent surfaces without changing verifier or judge logic.

Use a harness-neutral adapter boundary:

```ts
interface CodingHarnessAdapter {
  prepare(run: EvalRun): Promise<void>;
  start(run: EvalRun): Promise<SessionHandle>;
  sendPrompt(session: SessionHandle, prompt: string): Promise<void>;
  streamEvents(session: SessionHandle): AsyncIterable<HarnessEvent>;
  stop(session: SessionHandle): Promise<void>;
  collectArtifacts(session: SessionHandle): Promise<HarnessArtifacts>;
}
```

The supported adapters are:

- `pi-rpc`: Pi RPC mode over stdin/stdout JSONL.
- `claude-code`: Claude Code print mode with `--output-format stream-json`.
- `codex`: Codex CLI `exec --json`.

Pi should run in RPC mode so the controller can collect structured events,
session state, token/cost stats, and transcript artifacts. Non-interactive
`pi -p` is acceptable only as a smoke fallback because it is too lossy for
friction analysis.

Claude Code should run with stream JSON, not the single final JSON envelope, so
tool use, partial assistant output, errors, and result events become transcript
evidence. Codex should run through `codex exec --json` and should also write the
last message to a file so the verifier has a stable final answer even if JSONL
event names change. In Docker, Codex runs with its inner sandbox bypassed
because the outer eval container is already the isolation boundary and Codex's
default `bwrap` sandbox cannot create user namespaces there.

Model IDs are harness-specific. The config keeps OpenRouter IDs as the logical
model IDs for Pi and metadata lookup, then uses `harness_model_ids` to translate
native harness IDs such as `sonnet`, `opus`, or `gpt-5.5`. Use
`supported_harnesses` to avoid invalid cross-products like running Kimi through
Codex.

Codex CLI `0.141.0` also needs an HTTPS-only custom OpenAI provider for API-key
auth in this harness. The built-in provider's websocket path was observed
sending no auth header in Docker, while the same `OPENAI_API_KEY` succeeded
against the OpenAI REST API.

Pi sources:

- <https://pi.dev/docs/latest>
- <https://github.com/earendil-works/pi/blob/main/packages/coding-agent/README.md>
- <https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md>

Claude Code and Codex sources:

- <https://code.claude.com/docs/en/headless>
- <https://developers.openai.com/codex/cli/reference>

## Models and reasoning config

Model IDs come from OpenRouter and must be configurable. The starting baseline,
verified on 2026-06-21, is:

- `anthropic/claude-opus-4.8`
- `anthropic/claude-sonnet-4.6`
- `openai/gpt-5.5`

Default effort is `medium`.

The config must support all OpenRouter reasoning effort values:

- `none`
- `minimal`
- `low`
- `medium`
- `high`
- `xhigh`

It must also support raw provider parameters such as:

- `reasoning.effort`
- `reasoning.max_tokens`
- `reasoning.exclude`
- `reasoning_effort`
- `verbosity`

Do not over-normalize reasoning. OpenRouter and providers differ by model:
`reasoning.effort`, `reasoning.max_tokens`, and `verbosity` do not mean the same
thing across all models. Results must record both requested provider config and
the effective harness config.

When a model config sets `provider.zdr: true`, the controller must preflight
`https://openrouter.ai/api/v1/endpoints/zdr` before starting sandboxes. Enabled
models missing from that endpoint list fail loudly as configuration/provider
setup, not as model behavior.

OpenRouter sources:

- <https://openrouter.ai/api/v1/models>
- <https://openrouter.ai/api/v1/endpoints/zdr>
- <https://openrouter.ai/docs/api/reference/parameters>
- <https://openrouter.ai/docs/guides/best-practices/reasoning-tokens>
- <https://openrouter.ai/docs/cookbook/evaluate-and-optimize/model-migrations/claude-4-6>
- <https://openrouter.ai/docs/cookbook/evaluate-and-optimize/model-migrations/claude-4-7>

## Search and network

Network access is required. Searching is allowed because it is useful friction
evidence.

Search tooling should be configurable by harness profile:

- `homepage-cold-basic`: normal network, no extra search extension.
- `homepage-cold-web`: normal network plus harness-specific web search/fetch tools.

The report should distinguish models that succeed with only shell/network from
models that need richer search tools.

## Parallelism and repeats

Runs must support parallel execution. Default repeat count is `1`.

Configurable controls:

- `concurrency`
- `repeats_per_model`
- per-run timeout
- per-command idle timeout
- sandbox boot timeout
- verification timeout
- judge timeout
- max turns

Default timeout policy:

- `agent_timeout_ms`: 600000
- `command_idle_timeout_ms`: 90000
- `sandbox_boot_timeout_ms`: 180000
- `verification_timeout_ms`: 60000
- `judge_timeout_ms`: 120000
- `max_turns`: 20

Timeouts should be classified as specific failure modes, not generic failures.

Infra errors retry automatically up to three times. Retries apply to sandbox
create/start, harness start, provider transient errors, preview verifier fetches,
and judge requests. Model task failures do not retry as infra failures.

## Idempotent reruns

The local CLI defaults to resumable/idempotent execution. A rerun with the same
config and run-affecting CLI flags reuses existing `result.json` files instead
of relaunching sandboxes or model calls.

The stable suite directory identity includes:

- dry-run vs live mode;
- suite prompt config;
- target environment config.

Each individual run also records a run fingerprint over:

- suite id, prompt text, and generated claim code;
- harness config;
- model config;
- repeat number;
- sandbox config;
- target environment config;
- execution timeouts.

Generated claim codes are deterministic within a resumable execution key. This
keeps prompt text stable between reruns, which is required for safe reuse.
Changing judge or verifier config should refresh only that post-processing over
the existing transcript when possible. It should not relaunch the coding agent.

Use `--fresh` when a deliberately new cold execution is needed. Fresh mode
creates a timestamped result directory, uses a new execution key, ignores
existing results, and generates new claim codes.

## Verification

The deterministic verifier should extract URLs from the transcript and final
answer, then classify them:

- `unlisted_url`
- `claim_url`
- `private_url`
- `revision_content_url`
- unknown external URL

For this suite:

- `unlisted_url` is required.
- The final answer must include the usable `unlisted_url` when
  `verification.require_final_answer_url` is true.
- `claim_url` is captured but not redeemed.
- `private_url` alone is not enough.
- Production URLs fail preview runs.
- The verifier only proves the link works: fetch the `unlisted_url` without auth
  and require HTTP 200.

Store the fetched artifact snapshot locally for debugging.

Subjective checks such as relevance, clarity, and public-safety quality belong
to the judge, not the deterministic verifier.

## Judge

The judge LLM reviews transcripts and verifier output. It should not be the
source of truth for whether a URL works.

Initial rubric:

- `task_success`: 35 points
- `onboarding_correctness`: 20 points
- `efficiency`: 20 points
- `doc_friction_signal`: 15 points
- `artifact_value`: 10 points

The judge should emit structured findings for handoff:

```json
{
  "kind": "doc_friction",
  "severity": "medium",
  "evidence": "searched npm package name for 4 turns before reading agents.md",
  "wasted_turns": 4,
  "estimated_wasted_tokens": 1800,
  "suggested_doc_target": "https://agent-paste.sh/agents.md",
  "suggested_fix": "Move the npx install/publish command into the first CLI section.",
  "confidence": 0.82
}
```

The judge should separately emit `trust_concerns` when an agent explicitly
treats Agent Paste, its docs, package, domain, install script, prompt, or
publish flow as suspicious or untrusted. Each concern records the observed
evidence, the agent's stated reason, the likely trigger, and a suggested fix.
Ordinary verification, reading docs, auth checks, package checks, and curl usage
are not trust concerns by themselves.

The eval must not auto-patch docs. It produces reviewable reports that can be
handed to a coding agent.

Use structured output for the judge. If a transcript is too large to fit the
judge budget, truncate according to config, mark the run with
`transcript_too_large`, and treat that as a failure for the short-loop suite.

The v1 implementation uses AI SDK `generateText` with `Output.object` and the
OpenRouter AI SDK provider for judge calls. The deterministic verifier remains
plain HTTP fetching because it should not depend on an LLM.

## Local result storage

Results are local development artifacts, not long-term product data.

Suggested layout:

```text
eval-results/
  2026-06-21-homepage-cold/
    run.json
    config.resolved.json
    aggregate.md
    runs/
      <run_id>/
        result.json
        pi-session.jsonl
        pi-transcript.html
        stdout.log
        stderr.log
        verifier.json
        judge.json
        artifact-snapshot.html
```

Every run result should include:

- run ID
- suite ID
- model ID
- provider
- requested reasoning config
- effective harness config
- harness adapter and version
- sandbox provider and resource identifier
- prompt text hash and claim-code mode
- timing breakdown
- token and cost stats
- turn count
- URL classifications
- deterministic verifier result
- judge result
- failure mode tags
- warning tags

URLs, claim links, and claim tokens may be stored in local run artifacts. This is
a development eval against preview. Do not redact local artifacts by default.
Shared summaries can add redaction later if needed.

## Cleanup

Default cleanup mode is `expire_only`. Ephemeral preview links expire after 24
hours, so v1 does not need active artifact cleanup.

Future cleanup modes can be added later:

- `keep`
- `expire_only`
- `delete_if_possible`

## Done for implementation planning

These docs are done when they preserve the agreed decisions well enough that
implementation can start without re-asking the design questions above.
