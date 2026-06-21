import { API_BASE_URL, APP_BASE_URL } from "./copy";

const LLMS_TXT_BASE = `# agent-paste

> Publish agent-generated files or directories and return private, unlisted, or
> accountless links.

Start with the agent guide unless you are implementing a protocol client.

## Agent Entry Points

- [Agent guide](/agents.md): CLI-first publish, auth, ephemeral, claim, and MCP.
- [CLI reference](/docs/cli.md): Commands, publish modes, JSON output, pull, and edit.
- [Ephemeral publish](/docs/ephemeral.md): Accountless 24h publish and claim.
- [MCP server](/docs/mcp.md): OAuth-only remote MCP for hosted agents without CLI access.
- [Protocol auth metadata](${API_BASE_URL}/auth.md): auth.md client implementation.
- [Full docs corpus](/llms-full.txt): Complete public docs.

## Human Entry Points

- [Dashboard](${APP_BASE_URL}): Workspaces, Artifacts, Access Links, and billing.
- [Human docs](/docs): Product docs for humans and agents.
- [Markdown docs](/docs.md): Markdown index of public docs.
`;

const LLMS_PRICING_SECTION = `
## Pricing

- [Pricing](/pricing): Free vs Pro.
- [Billing dashboard](${APP_BASE_URL}/billing): Checkout and Portal.
`;

export function renderLlmsTxt(billingEnabled: boolean): string {
  return billingEnabled ? `${LLMS_TXT_BASE}${LLMS_PRICING_SECTION}` : LLMS_TXT_BASE;
}
