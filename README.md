# agent-paste

[![CI](https://github.com/zaks-io/agent-paste/actions/workflows/ci.yml/badge.svg)](https://github.com/zaks-io/agent-paste/actions/workflows/ci.yml)
[![Security](https://github.com/zaks-io/agent-paste/actions/workflows/security.yml/badge.svg)](https://github.com/zaks-io/agent-paste/actions/workflows/security.yml)
[![npm](https://img.shields.io/npm/v/@zaks-io/agent-paste?label=npm)](https://www.npmjs.com/package/@zaks-io/agent-paste)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](./LICENSE)

Publish a file or folder to a real website in one command:

```sh
npx @zaks-io/agent-paste publish ./report
# https://0123456789abcdef0123456789abcdef.agent-paste.sh/
```

The returned URL is the Artifact. It opens top-level without login. There is no
viewer wrapper, iframe, sandbox, or separate sharing command. HTML, CSS,
JavaScript, root-relative assets, inline Tailwind configuration, and external
HTTPS dependencies run on the Artifact's own origin.

## Quick start

```sh
npx @zaks-io/agent-paste login
npx @zaks-io/agent-paste publish ./report
```

Expected output:

```text
✓ Published "report"

  View      https://0123456789abcdef0123456789abcdef.agent-paste.sh/
  Expires   <expiration date>
  Upload    3/3 uploaded, 0 reused · 42 KB sent, 0 B cached

  Update    npx @zaks-io/agent-paste publish ./report --artifact-id art_01H...
            (revises this Artifact; the same link shows the latest revision)

  → open https://0123456789abcdef0123456789abcdef.agent-paste.sh/
```

Publishing with `--artifact-id` revises the existing Artifact. Its URL stays the
same and shows the latest Published Revision on refresh.

## Agent workflow

Agents with a shell should use the CLI:

```sh
agent-paste whoami --json
agent-paste publish <path> --json
```

`whoami` exits successfully even when signed out, so branch on the JSON
`authenticated` field. If signed out and browser auth is available, run
`agent-paste login`. If interactive login is unavailable, or the user explicitly
requests accountless publish, use:

```sh
agent-paste publish <path> --ephemeral --json
```

Every publish JSON result contains:

```json
{
  "schema_version": "2",
  "artifact_id": "art_...",
  "revision_id": "rev_...",
  "title": "report",
  "url": "https://0123456789abcdef0123456789abcdef.agent-paste.sh/",
  "expires_at": "<ISO 8601 expiration timestamp>"
}
```

Return `url` to the human. Ephemeral results also include `claim_url` for the
optional keep and ownership step.

Agents without a shell can connect to `https://mcp.agent-paste.sh`, authenticate
with OAuth, and use `publish_artifact` or `add_revision`. CLI and MCP share the
same publish path and return the same `url` contract.

### Install the agent skill

Install the repository's agent-paste skill for Claude Code, Codex, and other
compatible agents with the `skills` CLI:

```sh
npx skills add https://github.com/zaks-io/agent-paste/tree/main/skills/agent-paste \
  --agent claude-code codex
```

## Browser architecture

Each Artifact gets a cryptographically random 128-bit capability hostname:

```text
production  {32-lowercase-hex}.agent-paste.sh
preview     {32-lowercase-hex}-preview.agent-paste.sh
```

The API stores a private capability manifest in R2. The content Worker validates
the hostname, signed manifest, expiry, denylist, and requested path before
decrypting bytes. Revising an Artifact rewrites that manifest in place.

The production wildcard Worker route is a fallback. Exact product hosts such as
`app.agent-paste.sh`, `api.agent-paste.sh`, and `mcp.agent-paste.sh` remain owned
by their more-specific routes, and the content Worker rejects any hostname that
is not exactly the capability shape.

Previously issued signed `usercontent.agent-paste.sh/v/...` URLs continue until
their normal expiry. New publish results never return them.

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
