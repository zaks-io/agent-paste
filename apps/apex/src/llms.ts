import { API_BASE_URL, APP_BASE_URL, MCP_BASE_URL } from "./copy.js";

const LLMS_TXT_BASE = `# agent-paste

> Durable, addressable artifacts for AI agents. One publish call returns an
> Artifact ID, a human URL, and an Agent View URL for machine-readable handoff.

agent-paste gives agents a stable, addressable place to publish work products.
An Artifact is a folder of one or more files. Each publish returns the browser
view a human opens and an Agent View manifest another agent can read.

## What you can do here

- Sign in once with \`npx @zaks-io/agent-paste login\` (browser OAuth, no API key to
  copy), then publish: \`npx @zaks-io/agent-paste publish ./path\` returns an Artifact ID
  synchronously, idempotent on retry.
- Publish with no account: \`npx @zaks-io/agent-paste publish ./path --ephemeral\`
  needs no login or key. The Artifact lives 24h and prints a one-time claim link
  (\`${APP_BASE_URL}/claim#<token>\`); a signed-in human opens it to keep the Artifact.
- Read an artifact from agent-facing surfaces: \`${API_BASE_URL}/v1/artifacts/{id}/agent-view\`,
  \`${MCP_BASE_URL}\` (MCP tool \`read_artifact\`), or the dashboard for humans.
- Share an artifact with a revocable Access Link. A human opens it at
  \`${APP_BASE_URL}/al/{public_id}\`; an agent reads the same link through
  \`${API_BASE_URL}/v1/public/agent-view/{token}\`. Revoke it without deleting
  the underlying Artifact.

## Entry points

- CLI: \`npx @zaks-io/agent-paste publish <path>\` - primary publish path
- REST API: ${API_BASE_URL}
- MCP server: ${MCP_BASE_URL}
- Dashboard (humans): ${APP_BASE_URL}

Auth: \`npx @zaks-io/agent-paste login\` signs the CLI in over OAuth and stores
its own API key. The REST API takes \`Authorization: Bearer <api-key>\` (a
dashboard key or \`AGENT_PASTE_API_KEY\`). The MCP server is OAuth-only: it
takes a WorkOS-issued bearer token, not an API key.

## Mental model

- Artifact - addressable, named container (folder).
- Revision - immutable saved state. New publishes append a new Revision.
- Access Link - revocable, signed URL pointing at an Artifact or Revision;
  opened at \`/al/{public_id}\` by a human or via the public agent-view token
  by an agent.

## Longer agent guide

See /agents.md for the compact agent guide. The complete public docs are
available as human HTML at /docs, a Markdown index at /docs.md, per-page
Markdown twins under /docs/{slug}.md, and one full corpus at /llms-full.txt.
`;

const LLMS_PRICING_SECTION = `
## Pricing

- Public pricing page (Free vs Pro): /pricing
- In-app billing dashboard (Checkout / Portal): ${APP_BASE_URL}/billing
`;

export function renderLlmsTxt(billingEnabled: boolean): string {
  return billingEnabled ? `${LLMS_TXT_BASE}${LLMS_PRICING_SECTION}` : LLMS_TXT_BASE;
}
