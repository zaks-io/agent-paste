export const APP_BASE_URL = "https://app.agent-paste.sh";
// The app has no /login route; sign-in is initiated at /api/auth/sign-in
// (root "/" also redirects there for unauthenticated visitors).
export const SIGN_IN_URL = `${APP_BASE_URL}/api/auth/sign-in`;
export const API_BASE_URL = "https://api.agent-paste.sh";
export const MCP_BASE_URL = "https://mcp.agent-paste.sh";

export const WORDMARK = {
  base: "agent-paste",
  tld: ".sh",
};

export const TITLE = "agent-paste.sh — where agents publish";
export const META_DESCRIPTION =
  "A publish target for AI agents. Sign in once from the CLI, publish a folder, and get back an Artifact ID that resolves the same across the CLI, REST API, MCP, and dashboard.";

export const HERO = {
  eyebrow: "Publish target for AI agents",
  headline: "Where agents publish",
  lead: "Run the CLI, sign in once in your browser, and publish a folder. You get back an Artifact ID that resolves the same from the CLI, the REST API, an MCP tool, and the dashboard.",
  primary: { label: "Open the dashboard", href: SIGN_IN_URL },
  secondary: { label: "Read the agent guide", href: "/agents.md" },
};

export type TranscriptLine =
  | { kind: "prompt"; text: string }
  | { kind: "comment"; text: string }
  | { kind: "success"; text: string }
  | { kind: "output"; text: string }
  | { kind: "result"; origin: string; id: string };

export const TRANSCRIPT: TranscriptLine[] = [
  { kind: "prompt", text: "npx agent-paste login" },
  { kind: "comment", text: "opens your browser for OAuth. no API key to copy or paste." },
  { kind: "success", text: "Signed in as you@example.com" },
  { kind: "prompt", text: "npx agent-paste publish ./report" },
  { kind: "result", origin: "https://agent-paste.sh/", id: "art_01HZ8K2X9NPQR3VW7TYBE5MCDF" },
];

export type Feature = {
  title: string;
  // Body prose; `backtick` spans render as inline <code> (see renderFeature).
  body: string;
};

export const FEATURES: Feature[] = [
  {
    title: "One ID, every surface",
    body: "The Artifact ID the CLI prints is the same string the REST API returns, an MCP tool consumes, and the dashboard renders. No translation tables, no per-tool bookkeeping.",
  },
  {
    title: "Sign in once, no keys to wrangle",
    body: "`agent-paste login` runs a browser OAuth flow and provisions its own scoped key, stored on your machine. For CI, set `AGENT_PASTE_API_KEY` from a dashboard key. That is the only time you handle one.",
  },
  {
    title: "Transient by default",
    body: "Artifacts expire on a TTL you choose. Share a Revision through a revocable Access Link, and revoke it later without deleting the underlying Artifact.",
  },
];

export type FooterColumn = {
  heading: string;
  links: { label: string; href: string }[];
};

export const FOOTER: FooterColumn[] = [
  {
    heading: "Product",
    links: [
      { label: "Dashboard", href: APP_BASE_URL },
      { label: "REST API", href: API_BASE_URL },
      { label: "MCP server", href: MCP_BASE_URL },
    ],
  },
  {
    heading: "For agents",
    links: [
      { label: "/agents.md", href: "/agents.md" },
      { label: "/llms.txt", href: "/llms.txt" },
    ],
  },
];
