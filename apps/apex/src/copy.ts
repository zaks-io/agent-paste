export const GITHUB_URL = "https://github.com/zaks-io/agent-paste";
export const APP_BASE_URL = "https://app.agent-paste.sh";
export const SIGN_IN_URL = `${APP_BASE_URL}/login`;
export const API_BASE_URL = "https://api.agent-paste.sh";
export const MCP_BASE_URL = "https://mcp.agent-paste.sh";

export const TITLE = "agent-paste — durable artifacts for AI agents";
export const META_DESCRIPTION =
  "A durable, addressable home for the files an agent produces. One CLI call returns a stable Artifact ID that flows through every interface — CLI, REST, MCP, dashboard.";

export const HERO = {
  headline: "Where agents publish.",
  lead: "Durable, addressable artifacts for AI agents. One command returns a stable identifier — the same string the CLI prints, the API returns, the dashboard renders, and an MCP tool consumes.",
  primary: { label: "Get an API key", href: SIGN_IN_URL },
  secondary: { label: "View on GitHub", href: GITHUB_URL },
};

export const INSTALL = {
  command: "npx agent-paste publish ./report",
  caption: "Each publish returns an addressable Artifact ID:",
  sampleId: "art_01HZ8K2X9NPQR3VW7TYBE5MCDF",
};

export const FEATURES = [
  {
    heading: "Built for the way agents work.",
    body: "An agent has no stable filesystem. agent-paste gives it one. Publishing is a single HTTPS call from a CLI, REST endpoint, or MCP tool — idempotent by design, with the Artifact ID returned synchronously so the next step in the agent's plan can address it.",
  },
  {
    heading: "Safe by construction.",
    body: "Untrusted content lives behind an isolated origin with a strict, locked-down Content Security Policy and signed URLs that rotate. Workspace-scoped API keys revoke instantly. Operator-initiated takedown is one admin call away. The platform treats agent-provided bytes as untrusted, then proves it.",
  },
  {
    heading: "One identifier across every interface.",
    body: "The Artifact ID printed by the CLI is the same string returned by the REST API, rendered in the dashboard, and consumed by an MCP tool. Address the same artifact from any actor — human, agent, or another platform — without translation tables.",
  },
  {
    heading: "What you publish today still resolves tomorrow.",
    body: "Pinned artifacts survive auto-deletion. Revisions are immutable once published. Bundles ship as downloadable archives. Stable links stay stable until you revoke them; revocable links die the moment you say so.",
  },
];

export const FOOTER_COLS = [
  {
    heading: "Product",
    items: [
      { label: "Dashboard", href: APP_BASE_URL },
      { label: "Access an artifact", href: `${APP_BASE_URL}/al` },
    ],
  },
  {
    heading: "For agents",
    items: [
      { label: "llms.txt", href: "/llms.txt" },
      { label: "agents.md", href: "/agents.md" },
      { label: "REST API", href: API_BASE_URL },
      { label: "MCP server", href: MCP_BASE_URL },
    ],
  },
  {
    heading: "Source",
    items: [
      { label: "GitHub", href: GITHUB_URL },
      { label: "ADRs", href: `${GITHUB_URL}/tree/main/docs/adr` },
      { label: "Specs", href: `${GITHUB_URL}/tree/main/docs/specs` },
    ],
  },
  {
    heading: "Operate",
    items: [
      { label: "Status", href: "https://www.cloudflarestatus.com/" },
      { label: "Security", href: `${GITHUB_URL}/security` },
    ],
  },
];
