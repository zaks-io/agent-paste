# agent-paste

[![CI](https://github.com/zaks-io/agent-paste/actions/workflows/ci.yml/badge.svg)](https://github.com/zaks-io/agent-paste/actions/workflows/ci.yml)
[![Security](https://github.com/zaks-io/agent-paste/actions/workflows/security.yml/badge.svg)](https://github.com/zaks-io/agent-paste/actions/workflows/security.yml)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/zaks-io/agent-paste/badge)](https://scorecard.dev/viewer/?uri=github.com/zaks-io/agent-paste)
[![npm](https://img.shields.io/npm/v/@zaks-io/agent-paste?label=npm)](https://www.npmjs.com/package/@zaks-io/agent-paste)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](./LICENSE)

**Where agents publish.**

When your coding agent builds an HTML report or page, agent-paste turns it into an Artifact you can open and share. No deploy, no repo, no bucket.

```sh
npx @zaks-io/agent-paste publish ./report
# -> authenticated app viewer URL
```

It works from any coding agent with a shell (Claude Code, Codex, Cursor, CI),
and over MCP from a web chat that has none (ChatGPT, Claude, Gemini). Publish a
file or folder and get back an **Artifact** plus an authenticated app viewer URL,
an **Agent View** manifest for tools, and lifecycle controls so generated work
does not live forever by accident. Public sharing is explicit.

The hosted service is operated by Zaks.io, LLC. The source is Apache-2.0.

## Quick Start

Agents should check for an existing login before using the accountless path:

```sh
npx @zaks-io/agent-paste whoami
# if that succeeds:
npx @zaks-io/agent-paste publish ./report
```

If there is no login and interactive auth is not possible, publish
non-interactive work such as text, markdown, images, or static HTML/CSS with the
restricted ephemeral path:

```sh
npx @zaks-io/agent-paste publish ./report --ephemeral
```

Expected output:

```text
✓ Published "report"

  View      https://app.agent-paste.sh/artifacts/art_01H...
  Expires   2026-06-20
  Upload    3/3 uploaded, 0 reused · 42 KB sent, 0 B cached

  → open https://app.agent-paste.sh/artifacts/art_01H...

Open the claim link in a browser while signed in.
  Claim    https://app.agent-paste.sh/claim#ap_ct_...
```

For authenticated use, sign in once:

```sh
npx @zaks-io/agent-paste login
npx @zaks-io/agent-paste publish ./report
```

Add `--share` only when you intentionally want a public/shareable Share Link:

```sh
npx @zaks-io/agent-paste publish ./report --share
```

Need interactivity or JavaScript? Use authenticated publish, not `--ephemeral`.
Unclaimed ephemeral HTML is served under a script-disabled policy. Text,
markdown, images, and static pages are fine; browser apps and interactive
visualizations should use authenticated publish so they run inside the
controlled Artifact Viewer. Ephemeral is not the Free Plan; it is an unclaimed
restricted tier.

The human-facing URL model is:

```text
Artifact URL          https://app.agent-paste.sh/artifacts/{artifact_id}
Access Link Signed URL https://app.agent-paste.sh/al/{publicId}#{blob}
Revision Content URL  https://usercontent.agent-paste.sh/v/{content_token}/index.html
```

The Artifact URL is authenticated Workspace app navigation and is the default
`View` URL after publish. An Access Link Signed URL is a public/shareable URL
minted only when a Share Link or Revision Link is explicitly created. The
Revision Content URL is exact signed byte delivery for one Revision; direct
`usercontent` HTML is inert and should not be presented as the live page.

The npm package is [`@zaks-io/agent-paste`](./apps/cli/README.md). The installed
command is `agent-paste`. Standalone macOS, Linux, and Windows installers are
documented in the [CLI README](./apps/cli/README.md).

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

## Use Cases

The canonical use-case matrix lives in
[`docs/specs/use-cases.md`](./docs/specs/use-cases.md).

At a glance, agent-paste is for publishing one generated asset, opening remote
agent output anywhere, publishing from MCP hosts without CLI access, watching an
agent iterate, handing work from one tool to another, sharing one-off artifacts,
and running unattended with `--ephemeral`.

The core loop is intentionally small:

```text
agent creates something -> publish -> human opens URL -> agent reads Agent View -> Artifact expires later
```

## What It Does

- Publishes a file or folder as an **Artifact**.
- Returns an authenticated app viewer URL and exposes machine-readable Agent View for tools.
- Supports accountless ephemeral publish for agents with no human in the loop.
- Lets signed-in users claim ephemeral work into a Workspace.
- Supports explicit Access Link Signed URLs for public access to Artifact Viewers.
- Serves generated content from an isolated Content Origin with signed URLs.
- Uses Workspace policy for Auto Deletion and retention.
- Provides CLI, MCP, dashboard, and agent-readable docs surfaces.

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

## For Agents

Agents are first-class readers of the project:

- [`/agents.md`](https://agent-paste.sh/agents.md): compact operating guide for agents.
- [`/llms.txt`](https://agent-paste.sh/llms.txt): short machine-readable summary.
- [`/llms-full.txt`](https://agent-paste.sh/llms-full.txt): full public docs corpus.
- [`https://mcp.agent-paste.sh`](https://mcp.agent-paste.sh): hosted OAuth-only MCP surface for agents without CLI access.

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
