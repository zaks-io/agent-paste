import { API_BASE_URL, APP_BASE_URL, MCP_BASE_URL } from "./copy";

const LLMS_TXT_BASE = `# agent-paste

Agent Paste publishes files or directories and returns links.

Use the CLI when you can run commands. Use MCP only when the host can connect to
remote MCP but cannot run the CLI.

## CLI Flow

1. Check auth:
   \`npx @zaks-io/agent-paste whoami --json\`
   It exits 0 when signed out; read \`authenticated\`.
2. If signed in, publish:
   \`npx @zaks-io/agent-paste publish ./path --json\`
   This uploads to the user's Workspace. Return \`private_url\` to the user.
3. If the user wants anyone to open it without signing in:
   \`npx @zaks-io/agent-paste set-visibility <artifact_id> unlisted --json\`
   Use \`artifact_id\` from the publish JSON. Return \`unlisted_url\`. This is the
   no-login link.
4. To update a previous upload:
   \`npx @zaks-io/agent-paste publish ./path --artifact-id <artifact_id> --json\`
   Use the \`artifact_id\` from the earlier publish JSON. Existing links stay
   stable.
5. If not signed in and the user can log in:
   \`npx @zaks-io/agent-paste login\`
   This is OAuth and opens a browser window for the user. Then publish.
6. If no login/account is available:
   \`npx @zaks-io/agent-paste publish ./path --ephemeral --json\`
   This uploads anonymously, returns \`unlisted_url\`, and is pruned after 24h.
   Return \`claim_url\` too when the human wants to keep or claim it.

If a copied prompt includes \`--claim-code <clm_...>\`, preserve it on
\`publish --ephemeral\`. Agent Paste uses it for attribution and claim links.

Use \`agent_view_url\` when another agent needs file metadata; per-file URLs are
\`files[].url\`.

## Other Surfaces

- MCP: ${MCP_BASE_URL}. OAuth-only remote MCP. Use when CLI is unavailable.
- Auth metadata for protocol clients: ${API_BASE_URL}/auth.md
- Humans: ${APP_BASE_URL}
- More agent detail: /agents.md
- Full public docs: /llms-full.txt
`;

const LLMS_PRICING_SECTION = `
## Pricing

- Public pricing page (Free vs Pro): /pricing
- In-app billing dashboard (Checkout / Portal): ${APP_BASE_URL}/billing
`;

export function renderLlmsTxt(billingEnabled: boolean): string {
  return billingEnabled ? `${LLMS_TXT_BASE}${LLMS_PRICING_SECTION}` : LLMS_TXT_BASE;
}
