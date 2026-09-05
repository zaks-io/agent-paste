# agent-paste

[![CI](https://github.com/zaks-io/agent-paste/actions/workflows/ci.yml/badge.svg)](https://github.com/zaks-io/agent-paste/actions/workflows/ci.yml)
[![Security](https://github.com/zaks-io/agent-paste/actions/workflows/security.yml/badge.svg)](https://github.com/zaks-io/agent-paste/actions/workflows/security.yml)
[![npm](https://img.shields.io/npm/v/@zaks-io/agent-paste?label=npm)](https://www.npmjs.com/package/@zaks-io/agent-paste)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](./LICENSE)

Agent Paste turns files your agent creates into websites you can open and send
to someone else. Publish a report, a prototype, or a folder of generated HTML
and assets. The recipient gets a link they can open without an account.

## Why use it?

An agent can build something useful and leave it sitting in a local folder.
Agent Paste handles the next step: putting that work on the web so someone can
actually look at it. You don't need to set up a hosting project for each result.

- Send a generated report to a teammate who doesn't have your working directory.
- Open an interactive HTML demo in the browser to try what the agent built.
- Ask for changes and publish them to the same link. Recipients see the update
  when they refresh.

It hosts the files you publish. For an app with a server or database, host those
services separately.

## Try it without an account

Publish an existing file or folder:

```sh
npx @zaks-io/agent-paste publish ./report --ephemeral
# https://01234-56789-abcde-fghjd.agent-paste.link/
```

Open the returned link to view your work. Accountless publishes expire
automatically and render static content. JavaScript, network requests, and forms
are blocked until you claim the result. The command also returns a claim link
if you want to keep it.

For interactive demos, sign in before publishing.

## Quick start

```sh
npx @zaks-io/agent-paste login
npx @zaks-io/agent-paste publish ./report
```

Expected output:

```text
✓ Published "report"

  View      https://01234-56789-abcde-fghjd.agent-paste.link/
  Expires   <expiration date>
  Upload    3/3 uploaded, 0 reused · 42 KB sent, 0 B cached

  Update    npx @zaks-io/agent-paste publish ./report --artifact-id art_01H...
            (revises this Artifact; the same link shows the latest revision)

  → open https://01234-56789-abcde-fghjd.agent-paste.link/
```

Publishing with `--artifact-id` revises the existing Artifact. Its URL stays the
same and shows the latest Published Revision on refresh.

## Use it with your agent

Agents that can run commands should use the CLI. Install the agent-paste skill
for Claude Code and Codex to give them the publishing workflow:

```sh
npx skills add https://github.com/zaks-io/agent-paste/tree/main/skills/agent-paste \
  --agent claude-code codex
```

Then ask your agent to publish the files it created with Agent Paste and return
the link. The [agent skill](./skills/agent-paste/SKILL.md) covers login,
accountless publishing, and updating an existing Artifact.

Agents without a shell can connect to `https://mcp.agent-paste.sh` and
authenticate with OAuth. See the [MCP setup guide](./docs/mcp.md).

## What to know before publishing

Anyone with an Artifact's link can view it without signing in. Treat the link
as access to its contents.

Signed-in publishes support HTML, CSS, JavaScript, and external HTTPS
dependencies. Each Artifact runs on its own origin, separate from the dashboard.
Service workers are unsupported.

For automation details, see the [CLI contract](./docs/specs/cli.md). For content
policies and storage internals, see
[content rendering](./docs/specs/content-rendering.md) and
[architecture](./docs/specs/architecture.md).

## Repository

| Path                 | Purpose                                               |
| -------------------- | ----------------------------------------------------- |
| `apps/api`           | Authenticated control plane and publish coordination. |
| `apps/upload`        | Signed upload sessions and byte ingestion.            |
| `apps/content`       | Capability-host and legacy signed content serving.    |
| `apps/web`           | Dashboard, authentication, claim, and billing.        |
| `apps/cli`           | Published `agent-paste` command.                      |
| `apps/mcp`           | OAuth MCP server for hosted agents.                   |
| `packages/contracts` | Shared route and payload contracts.                   |
| `packages/db`        | Postgres and local repository implementations.        |

Start with [`docs/ops/project-status.md`](./docs/ops/project-status.md), then
[`CONTEXT.md`](./CONTEXT.md), [`docs/specs/README.md`](./docs/specs/README.md),
and [`docs/adr/README.md`](./docs/adr/README.md).

Licensed under [Apache-2.0](./LICENSE). The hosted service is operated by
Zaks.io, LLC.
