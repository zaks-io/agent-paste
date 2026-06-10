import { API_BASE_URL, APP_BASE_URL, MCP_BASE_URL } from "./copy";

const LLMS_TXT_BASE = `# agent-paste

> Durable, addressable artifacts for AI agents. One publish call returns an
> Artifact ID, an access_link_url for live human handoff, and an Agent View URL for machine-readable handoff.

agent-paste gives agents a stable, addressable place to publish work products.
An Artifact is a folder of one or more files. User-facing publish flows should
return access_link_url, the Access Link Signed URL minted from a Share Link, and
an Agent View manifest another agent can read. Do not send users to the
authenticated Artifact URL or the usercontent Revision Content URL as the final
live page.

## What you can do here

- Sign in once with \`npx @zaks-io/agent-paste login\` (browser OAuth, no API key to
  copy), then publish: \`npx @zaks-io/agent-paste publish ./path\` returns an Artifact ID
  synchronously, idempotent on retry.
- Before using the accountless path, run \`npx @zaks-io/agent-paste whoami\`.
  If it succeeds, publish normally. If it fails, ask the user to run
  \`npx @zaks-io/agent-paste login\` when interactive auth is possible.
- Ephemeral fallback: \`npx @zaks-io/agent-paste publish ./path --ephemeral\`
  ignores stored login and \`AGENT_PASTE_API_KEY\`. Use it only when no auth is
  available or the user explicitly asks for accountless publish. Ephemeral is not
  the Free Plan: it is an unclaimed restricted tier. The Artifact lives 24h and
  prints a one-time claim link (\`${APP_BASE_URL}/claim#<token>\`); a signed-in
  human opens it to keep the Artifact. Use it for non-interactive text,
  markdown, images, and static HTML/CSS. Unclaimed ephemeral HTML is
  script-disabled, so use authenticated publish for interactive pages, browser
  apps, or visualizations that need JavaScript.
- Read an artifact from agent-facing surfaces: \`${API_BASE_URL}/v1/artifacts/{id}/agent-view\`,
  \`${MCP_BASE_URL}\` (MCP tool \`read_artifact\`), or the dashboard for humans.
- Share an artifact with a revocable Share Link. For a live page, return its
  minted Access Link Signed URL. A human opens it at
  \`${APP_BASE_URL}/al/{public_id}#...\`; an agent resolves the same link through
  \`${API_BASE_URL}/v1/access-links/resolve\`. Revoke it without deleting the
  underlying Artifact.
- For live-updating human handoff, return \`access_link_url\`. In MCP publish
  tools, leave \`share\` at its default \`true\` and return \`access_link_url\`.
  Do not return \`artifact_url\` or \`usercontent.agent-paste.sh/v/...\` as the
  final live page.

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
- Access Link - revocable grant family for unauthenticated read access. Share
  Links and Revision Links are Access Link types; an Access Link Signed URL is
  the minted URL string.
- Artifact URL - authenticated Artifact detail URL for workspace management; not
  the primary user-facing live link.
- Revision Content URL - signed \`usercontent.agent-paste.sh/v/...\` content URL
  for one exact Revision. It expires and does not Live Update.
- Share Link - Access Link type that follows the latest Published Revision for
  the Artifact Viewer.
- Access Link Signed URL - the URL string minted from an Access Link. Return the
  one minted from a Share Link to humans for the live page.

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
