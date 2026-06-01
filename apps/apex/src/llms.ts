import { API_BASE_URL, APP_BASE_URL, MCP_BASE_URL } from "./copy.js";

export const LLMS_TXT = `# agent-paste

> Durable, addressable artifacts for AI agents. One publish call returns a stable
> Artifact ID that the CLI prints, the REST API returns, the dashboard renders,
> and an MCP tool consumes — the same string across every interface.

agent-paste gives agents a stable, addressable place to publish work products.
An Artifact is a folder of one or more files. Each publish returns an Artifact
ID (\`art_…\`) that resolves the same artifact from any actor — human, agent, or
another platform — without translation tables.

## What you can do here

- Sign in once with \`npx @zaks-io/agent-paste login\` (browser OAuth, no API key to
  copy), then publish: \`npx @zaks-io/agent-paste publish ./path\` returns an Artifact ID
  synchronously, idempotent on retry.
- Address an artifact from any surface: \`${API_BASE_URL}/v1/artifacts/{id}\`,
  \`${MCP_BASE_URL}\` (MCP tool \`read_artifact\`), or the dashboard at
  \`${APP_BASE_URL}/artifacts/{id}\`.
- Share an artifact with a revocable Access Link. A human opens it at
  \`${APP_BASE_URL}/al/{public_id}\`; an agent reads the same link through
  \`${API_BASE_URL}/v1/public/agent-view/{token}\`. Revoke it without deleting
  the underlying Artifact.

## Entry points

- CLI: \`npx @zaks-io/agent-paste publish <path>\` — primary publish path
- REST API: ${API_BASE_URL}
- MCP server: ${MCP_BASE_URL}
- Dashboard (humans): ${APP_BASE_URL}

Auth: \`npx @zaks-io/agent-paste login\` signs the CLI in over OAuth and stores
its own API key. The REST API takes \`Authorization: Bearer <api-key>\` (a
dashboard key or \`AGENT_PASTE_API_KEY\`). The MCP server is OAuth-only: it
takes a WorkOS-issued bearer token, not an API key.

## Mental model

- Artifact — addressable, named container (folder).
- Revision — immutable saved state. New publishes append a new Revision.
- Access Link — revocable, signed URL pointing at an Artifact or Revision;
  opened at \`/al/{public_id}\` by a human or via the public agent-view token
  by an agent.

## Longer agent guide

See /agents.md for the full guide: object model, CLI examples, REST shape,
auth model, and the twelve MCP tools.
`;
