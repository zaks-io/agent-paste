# agent-paste

[![CI](https://github.com/zaks-io/agent-paste/actions/workflows/ci.yml/badge.svg)](https://github.com/zaks-io/agent-paste/actions/workflows/ci.yml)
[![Security](https://github.com/zaks-io/agent-paste/actions/workflows/security.yml/badge.svg)](https://github.com/zaks-io/agent-paste/actions/workflows/security.yml)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/zaks-io/agent-paste/badge)](https://scorecard.dev/viewer/?uri=github.com/zaks-io/agent-paste)
[![npm](https://img.shields.io/npm/v/@zaks-io/agent-paste?label=npm)](https://www.npmjs.com/package/@zaks-io/agent-paste)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](./LICENSE)

**Where agents publish.** Your agent built it. Open it anywhere.

Your coding agent just generated a report, a chart, a small HTML app. agent-paste
turns that file or folder into a hosted **Artifact** with a URL you can open and
share. No deploy, no repo, no bucket.

```sh
npx @zaks-io/agent-paste publish ./report
# -> https://app.agent-paste.sh/v/art_01H...
```

It works from any coding agent with a shell (Claude Code, Codex, Cursor, CI),
and over MCP from web chats that have none (ChatGPT, Claude, Gemini). The hosted
service is operated by Zaks.io, LLC. The source is Apache-2.0.

## How It Works

The core loop is intentionally small:

```text
agent creates something -> publish -> human opens URL -> agent reads Agent View -> Artifact expires later
```

Every publish gives you:

- An **Artifact**: the published unit, revisable in place as the agent iterates.
- A **View URL** for humans: authenticated app navigation into the Artifact Viewer.
- An **Agent View**: a machine-readable manifest so tools can read what was published.
- **Lifecycle controls**: Workspace Auto Deletion policy, so generated work does
  not live forever by accident.

No-login access is explicit. Content is served from an isolated Content Origin
with signed URLs, and an unlisted Share Link is minted only when you explicitly
set visibility to `unlisted`.

## Quick Start

Sign in once, then publish:

```sh
npx @zaks-io/agent-paste login
npx @zaks-io/agent-paste publish ./report
```

Expected output:

```text
✓ Published "report"

  View      https://app.agent-paste.sh/v/art_01H...
  Expires   2026-06-20
  Upload    3/3 uploaded, 0 reused · 42 KB sent, 0 B cached

  Update    npx @zaks-io/agent-paste publish ./report --artifact-id art_01H...
            (revises this Artifact; same link live-updates the open page)

  → open https://app.agent-paste.sh/v/art_01H...
```

Want a shareable no-login link? That is explicit:

```sh
npx @zaks-io/agent-paste set-visibility art_01H... unlisted
```

### Auth decision for agents

Agents should choose one publish surface:

- **Can run commands:** use the CLI. Run `agent-paste whoami --json` and branch
  on `authenticated`, not the process exit code. If signed in, publish normally.
  If signed out and browser auth is possible, run `agent-paste login`, then
  publish normally. Use `--ephemeral` only when login is unavailable, or when
  the user explicitly asks for accountless publish.
- **Cannot run commands but can use remote MCP:** connect
  `https://mcp.agent-paste.sh`, complete OAuth, run the `whoami` tool, then use
  MCP publish tools. MCP is not anonymous.
- **Implementing a direct HTTP auth.md client:** discover `GET /auth.md`.
  Start with `{ "type": "anonymous" }`, publish with the pre-claim credential,
  and send the human the browser verification URI plus code only when they want
  to claim. The signed-in browser session that completes claim chooses the
  destination Workspace. The `claim_url` from `/agent/identity` is the API claim
  endpoint; the browser URL is `claim.verification_uri` from
  `/agent/identity/claim`.

### No login available

Unattended agents can publish text, markdown, images, or static HTML/CSS with
the restricted ephemeral path -- no account needed:

```sh
npx @zaks-io/agent-paste publish ./report --ephemeral
```

The output leads with `unlisted_url`, a working no-login link. Relay that for
immediate viewing. Relay `claim_url` only when the human wants to keep, own, or
unlock interactivity for the Artifact. There is no user-backed session before
claim; the signed-in browser session that opens `claim_url` owns it after claim.
Two rules keep this path safe:

- **Check before falling back.** Run `whoami --json` first -- `whoami` exits
  `0` even when signed out, so the exit code tells you nothing. Check the JSON:
  `{"authenticated": false}` means no usable credential; a signed-in response
  carries the resolved Workspace, actor, and scopes instead. If signed in,
  publish normally; if a human is present, run `login` first and skip
  `--ephemeral`.
- **No JavaScript.** Unclaimed ephemeral HTML is served under a script-disabled
  policy. Static pages are fine; browser apps and interactive visualizations
  need authenticated publish, which runs them inside the controlled Artifact
  Viewer.

The npm package is [`@zaks-io/agent-paste`](./apps/cli/README.md). The installed
command is `agent-paste`; examples use `npx @zaks-io/agent-paste ...` for
one-shot runs and `agent-paste ...` after installation. Standalone macOS, Linux,
and Windows installers are documented in the [CLI README](./apps/cli/README.md).

## MCP For Hosted Agents

Use MCP when an agent can connect to a remote MCP server but cannot run the CLI:

```text
https://mcp.agent-paste.sh
```

MCP is OAuth-only. Connect the remote server in the host, complete OAuth, then
start with the `whoami` tool.
Agents can publish text Artifacts, read Agent Views, add Revisions, and manage
Share Links and Revision Links. Folder and binary publishes stay in the CLI.

Read [`docs/mcp.md`](./docs/mcp.md) for the practical MCP guide, or
[`docs/ops/runbook-mcp-hosts.md`](./docs/ops/runbook-mcp-hosts.md) for host
onboarding and smoke verification.

## URLs And Sharing

Three URL shapes, three jobs:

```text
Private Link           https://app.agent-paste.sh/v/{artifact_id}
Access Link Signed URL https://app.agent-paste.sh/al/{publicId}#{blob}
Revision Content URL   https://usercontent.agent-paste.sh/v/{content_token}/index.html
```

The Private Link is authenticated Workspace app navigation and is the default
`View` URL after publish. The dashboard-only Artifact Console at
`/artifacts/{artifact_id}` is for management, not handoff. An Access Link Signed
URL is the unlisted no-login URL, minted only when a Share Link or Revision Link
is explicitly created. The Revision Content URL is exact signed byte delivery
for one Revision; direct `usercontent` HTML is inert and should not be presented
as the live page.

A plain HTTP status check is not enough to verify a Private Link: unauthenticated
clients may receive the app shell or sign-in redirect state with HTTP 200. Use a
Share Link from `set-visibility unlisted` for no-login browser handoff, or use
Agent View and its `files[].url` entries for machine verification.

## Use Cases

Publishing one generated asset, opening remote agent output anywhere, publishing
from MCP hosts without CLI access, watching an agent iterate, handing work from
one tool to another, sharing one-off artifacts, and running unattended with
`--ephemeral`. The canonical use-case matrix lives in
[`docs/specs/use-cases.md`](./docs/specs/use-cases.md).

## For Agents

Agents are first-class readers of the project:

- [`/agents.md`](https://agent-paste.sh/agents.md): compact operating guide for agents.
- [`/llms.txt`](https://agent-paste.sh/llms.txt): short machine-readable summary.
- [`/llms-full.txt`](https://agent-paste.sh/llms-full.txt): full public docs corpus.
- [`https://mcp.agent-paste.sh`](https://mcp.agent-paste.sh): hosted OAuth-only MCP surface for agents without CLI access.

## Choose Your Path

| Goal                         | Start here                                                                                     |
| ---------------------------- | ---------------------------------------------------------------------------------------------- |
| Use the CLI                  | [`apps/cli/README.md`](./apps/cli/README.md)                                                   |
| Use MCP from hosted agents   | [`docs/mcp.md`](./docs/mcp.md)                                                                 |
| Understand use cases         | [`docs/specs/use-cases.md`](./docs/specs/use-cases.md)                                         |
| Get into the code            | [`docs/development.md`](./docs/development.md)                                                 |
| Contribute                   | [`CONTRIBUTING.md`](./CONTRIBUTING.md)                                                         |
| Read specs and ADRs          | [`docs/specs/README.md`](./docs/specs/README.md), [`docs/adr/README.md`](./docs/adr/README.md) |
| Check current project status | [`docs/ops/project-status.md`](./docs/ops/project-status.md)                                   |
| Orient an agent              | [`AGENTS.md`](./AGENTS.md)                                                                     |
| Report a vulnerability       | [`SECURITY.md`](./SECURITY.md)                                                                 |

## Project Status

agent-paste is live in production and in early alpha. The hosted service is
available, the CLI/npm package and public docs are part of the supported surface,
and the product is still intentionally small while the core handoff loop hardens.
Current production status, alpha limits, and backlog live in
[`docs/ops/project-status.md`](./docs/ops/project-status.md).

## Repo Map

| Area         | What it owns                                                                |
| ------------ | --------------------------------------------------------------------------- |
| `apps/cli`   | Public CLI for login, logout, whoami, publish, and standalone upgrade.      |
| `apps/apex`  | Public site, docs, legal pages, install scripts, `/llms.txt`, `/agents.md`. |
| `apps/web`   | Dashboard, Access Link viewer, claim, billing, and Workspace UI.            |
| API Workers  | Control plane, uploads, content reads, jobs, stream, and MCP services.      |
| `packages/*` | Contracts, DB/repository, auth, tokens, storage, billing, config, tooling.  |
| `docs/*`     | Specs, ADRs, development reference, project status, and operating docs.     |

For the full workspace inventory, root commands, package script policy, hooks,
and monorepo maintenance rules, read [`docs/development.md`](./docs/development.md).

## Source Of Truth

- [`docs/specs/README.md`](./docs/specs/README.md): current product and system behavior.
- [`docs/specs/use-cases.md`](./docs/specs/use-cases.md): canonical product use cases.
- [`docs/mcp.md`](./docs/mcp.md): practical MCP guide for hosted agents.
- [`docs/adr/README.md`](./docs/adr/README.md): architecture decision trail.
- [`CONTEXT.md`](./CONTEXT.md): domain language.
- [`packages/contracts`](./packages/contracts): Zod schemas, route registries, and OpenAPI generation.
- [`docs/ops/project-status.md`](./docs/ops/project-status.md): production status, ledgers, and backlog.

Specs are the current behavioral truth. ADRs explain why decisions were made.

## License

Apache License 2.0. See [`LICENSE`](./LICENSE) and [`NOTICE`](./NOTICE).
Copyright 2026 Zaks.io, LLC.
