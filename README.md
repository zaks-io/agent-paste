# agent-paste

[![CI](https://github.com/zaks-io/agent-paste/actions/workflows/ci.yml/badge.svg)](https://github.com/zaks-io/agent-paste/actions/workflows/ci.yml)
[![Security](https://github.com/zaks-io/agent-paste/actions/workflows/security.yml/badge.svg)](https://github.com/zaks-io/agent-paste/actions/workflows/security.yml)
[![npm](https://img.shields.io/npm/v/@zaks-io/agent-paste?label=npm)](https://www.npmjs.com/package/@zaks-io/agent-paste)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](./LICENSE)

Publish a file or folder to a real website in one command:

```sh
npx @zaks-io/agent-paste publish ./report
# https://0123456789abcdef0123456789abcdef.agent-paste.link/
```

The returned URL is the Artifact. It opens top-level without login. There is no
viewer wrapper, iframe, or separate sharing command. Claimed Artifacts run HTML,
CSS, JavaScript, root-relative assets, inline Tailwind configuration, and
external HTTPS dependencies on their own origin. Ephemeral Artifacts render
static content with scripts, connections, forms, and workers blocked until claim.

## Quick start

```sh
npx @zaks-io/agent-paste login
npx @zaks-io/agent-paste publish ./report
```

Expected output:

```text
✓ Published "report"

  View      https://0123456789abcdef0123456789abcdef.agent-paste.link/
  Expires   <expiration date>
  Upload    3/3 uploaded, 0 reused · 42 KB sent, 0 B cached

  Update    npx @zaks-io/agent-paste publish ./report --artifact-id art_01H...
            (revises this Artifact; the same link shows the latest revision)

  → open https://0123456789abcdef0123456789abcdef.agent-paste.link/
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
  "url": "https://0123456789abcdef0123456789abcdef.agent-paste.link/",
  "expires_at": "<ISO 8601 expiration timestamp>"
}
```

Return `url` to the human. Ephemeral results also include `claim_url` for the
optional keep and ownership step.

Agents without a shell can connect to `https://mcp.agent-paste.sh`, authenticate
with OAuth, and use `publish_artifact` or `add_revision`. CLI and MCP share the
same publish path and return the same `url` contract.

### Install the agent skill

Install the repository's agent-paste skill for Claude Code and Codex with the
`skills` CLI:

```sh
npx skills add https://github.com/zaks-io/agent-paste/tree/main/skills/agent-paste \
  --agent claude-code codex
```

## Browser architecture

Each Artifact gets a cryptographically random 95-bit capability hostname:

```text
production  {xxxxx-xxxxx-xxxxx-xxxxx}.agent-paste.link
preview     {xxxxx-xxxxx-xxxxx-xxxxx}-preview.agent-paste.link
```

The API stores a private capability manifest in R2. The content Worker validates
the hostname, signed manifest, expiry, denylist, and requested path before
decrypting bytes. Revising an Artifact rewrites that manifest in place.

Artifact origins live on a separate registrable domain from product hosts such
as `app.agent-paste.sh`, `api.agent-paste.sh`, and `mcp.agent-paste.sh`. The
content Worker rejects any hostname that is not exactly the capability shape.
New IDs contain 19 random base32 symbols plus a check symbol. Legacy 32-character
lowercase hexadecimal IDs remain valid and are never rewritten.

Previously issued signed `usercontent.agent-paste.sh/v/...` URLs continue until
their normal expiry. Previously issued capability URLs map directly from
`{id}[-preview].agent-paste.sh/{path}` to
`{id}[-preview].agent-paste.link/{path}` with a permanent redirect that preserves
the path and query. New publish results return only `.agent-paste.link` URLs.

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
