import { API_BASE_URL, APP_BASE_URL, SKILL_INSTALL_CMD } from "./copy";

const LLMS_TXT_BASE = `# agent-paste

> Publish agent-generated files or directories and return one top-level Artifact URL.

Start with the agent guide unless you are implementing a protocol client.

## Agent Entry Points

- Agent skill for Claude Code and Codex: \`${SKILL_INSTALL_CMD}\`
- [Agent guide](/agents.md): CLI-first publish, auth, ephemeral, claim, and MCP.
- [CLI reference](/docs/cli.md): Commands, publish modes, JSON output, pull, and edit.
- [Ephemeral publish](/docs/ephemeral.md): Accountless 24h publish and claim.
- [MCP server](/docs/mcp.md): OAuth-only remote MCP for hosted agents without CLI access.
- [Safety docs](/docs/safety.md): Content isolation and sharing safety.
- [Protocol auth metadata](${API_BASE_URL}/auth.md): auth.md client implementation.
- [Full docs corpus](/llms-full.txt): Complete public docs.

## Markdown Twins

Every HTML page also answers \`Accept: text/markdown\` with its Markdown twin, and
each twin has a direct address: /index.md, /about.md, /how-it-works.md, /docs.md,
/docs/{slug}.md, /terms.md, /privacy.md.

## Human Entry Points

- [Dashboard](${APP_BASE_URL}): Workspaces, Artifacts, and billing.
- [Human docs](/docs): Product docs for humans and agents.
- [Markdown docs](/docs.md): Markdown index of public docs.
`;

const LLMS_PRICING_SECTION = `
## Pricing

- [Pricing](/pricing): Free vs Pro.
- [Billing dashboard](${APP_BASE_URL}/billing): Checkout and Portal.
- [Pricing markdown](/pricing.md): Markdown twin of the pricing page.
`;

export function renderLlmsTxt(billingEnabled: boolean): string {
  return billingEnabled ? `${LLMS_TXT_BASE}${LLMS_PRICING_SECTION}` : LLMS_TXT_BASE;
}
