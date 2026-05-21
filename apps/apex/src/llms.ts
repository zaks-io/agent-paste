import { API_BASE_URL, APP_BASE_URL, GITHUB_URL, MCP_BASE_URL } from "./copy.js";

export const LLMS_TXT = `# agent-paste

> Durable, addressable artifacts for AI agents. One publish call returns a stable
> Artifact ID that the CLI prints, the REST API returns, the dashboard renders,
> and an MCP tool consumes — the same string across every interface.

agent-paste gives agents a stable, addressable place to publish work products.
An Artifact is a folder of one or more files. Each publish returns an Artifact
ID (\`art_…\`) that resolves the same artifact from any actor — human, agent, or
another platform — without translation tables.

## What you can do here

- Publish files from a workflow: \`npx agent-paste publish ./path\` returns an
  Artifact ID synchronously, idempotent on retry.
- Address an artifact from any surface: \`${API_BASE_URL}/v1/artifacts/{id}\`,
  \`${MCP_BASE_URL}\` (MCP tool \`agent_paste.get\`), or the dashboard at
  \`${APP_BASE_URL}/artifacts/{id}\`.
- Share an artifact with a revocable link (\`/r/{token}\`) or a stable
  workspace-scoped link the workspace owner can rotate.

## Entry points

- CLI: \`npx agent-paste publish <path>\` — primary publish path
- REST API: ${API_BASE_URL}
- MCP server: ${MCP_BASE_URL}
- Dashboard (humans): ${APP_BASE_URL}
- Source: ${GITHUB_URL}

## Mental model

- Artifact — addressable, named container (folder).
- Revision — immutable saved state. New publishes append a new Revision.
- Access Link — revocable, signed URL pointing at an Artifact or Revision.

## Longer agent guide

See /agents.md for the full guide: object model, CLI examples, REST shape,
and MCP tool signatures.
`;
