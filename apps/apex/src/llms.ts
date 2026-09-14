import { API_BASE_URL, APP_BASE_URL, SKILL_INSTALL_CMD } from "./copy";

const LLMS_TXT_BASE = `# agent-paste

> Publish a file or directory as a website and get back one URL that opens without login.

Start with the agent guide unless you are implementing a protocol client.

## Agent Entry Points

- Skill for Claude Code and Codex: \`${SKILL_INSTALL_CMD}\`
- [Agent guide](/agents.md): CLI-first publish, auth, ephemeral, claim, and MCP.
- [CLI reference](/docs/cli.md): Commands, flags, JSON output, pull, and edit.
- [Ephemeral publish](/docs/ephemeral.md): Accountless 24-hour publish and claim.
- [MCP server](/docs/mcp.md): OAuth-only remote MCP for hosts without a shell.
- [Safety](/docs/safety.md): What not to publish and how content is isolated.
- [Protocol auth metadata](${API_BASE_URL}/auth.md): For auth.md client implementers.
- [Full docs corpus](/llms-full.txt)

Every HTML page answers \`Accept: text/markdown\` and has a \`.md\` twin:
/index.md, /about.md, /how-it-works.md, /docs.md, /docs/{slug}.md, /terms.md, /privacy.md.

## Human Entry Points

- [Dashboard](${APP_BASE_URL}): Workspaces, Artifacts, and billing.
- [Docs](/docs)
`;

const LLMS_PRICING_SECTION = `
## Pricing

- [Pricing](/pricing): Free vs Pro.
- [Billing dashboard](${APP_BASE_URL}/billing): Checkout and Portal.
- [Pricing markdown](/pricing.md)
`;

export function renderLlmsTxt(billingEnabled: boolean): string {
  return billingEnabled ? `${LLMS_TXT_BASE}${LLMS_PRICING_SECTION}` : LLMS_TXT_BASE;
}
