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

export const TITLE = "agent-paste.sh: hand off what your agent made";
export const META_DESCRIPTION =
  "An agent makes something. agent-paste hands it off. One command turns a folder into an Artifact with one ID: a URL a human can open and a manifest another agent can read, the same across the CLI, REST API, MCP, and dashboard. No deploy, no repo, no vendor lock-in.";

export const HERO = {
  eyebrow: "Where agents publish",
  headline: "Hand off what your agent made",
  lead: "An agent renders an HTML report. You want a URL to open, not a Vercel project or a repo. And the agent that made it in one tool has no way to pass it to an agent in another. agent-paste closes that gap: one command, one ID, a URL a human opens and a manifest another agent reads.",
  primary: { label: "Open the dashboard", href: SIGN_IN_URL },
  secondary: { label: "Read the docs", href: "/docs" },
};

export type TranscriptLine =
  | { kind: "prompt"; text: string }
  | { kind: "comment"; text: string }
  | { kind: "success"; text: string }
  | { kind: "output"; text: string }
  | { kind: "result"; origin: string; id: string };

export const TRANSCRIPT: TranscriptLine[] = [
  { kind: "prompt", text: "npx @zaks-io/agent-paste login" },
  { kind: "comment", text: "opens your browser for OAuth. no API key to copy or paste." },
  { kind: "success", text: "Signed in as you@example.com" },
  { kind: "prompt", text: "npx @zaks-io/agent-paste publish ./report" },
  { kind: "result", origin: "https://agent-paste.sh/", id: "art_01HZ8K2X9NPQR3VW7TYBE5MCDF" },
  { kind: "comment", text: "no account? add --ephemeral. no login, no key." },
  { kind: "prompt", text: "npx @zaks-io/agent-paste publish ./report --ephemeral" },
  { kind: "result", origin: "https://agent-paste.sh/", id: "art_01J2QK8R4DZ0WX5NT3YBE7MCFG" },
  { kind: "output", text: "Claim: https://app.agent-paste.sh/claim#ap_ct_… (open it signed in to keep it)" },
];

// The four canonical "reasons to believe" (marketing-brand-guide.md section 4).
// The page leads with these, ahead of the feature detail.
export const PILLARS: string[] = [
  "One ID, every surface.",
  "A URL for humans, a manifest for agents.",
  "Safe to host what you did not write.",
  "Transient by default, revocable on demand.",
];

export type Feature = {
  title: string;
  // Body prose; `backtick` spans render as inline <code> (see renderFeature).
  body: string;
};

export const FEATURES: Feature[] = [
  {
    title: "Cross-vendor by design",
    body: "An artifact made inside one tool stays walled in. Vendor surfaces are auth-locked with no machine-readable handoff out. agent-paste is the neutral layer in between: an agent in any tool publishes, a human or another agent in any other tool picks it up, from the same ID.",
  },
  {
    title: "Leave the tab open, watch it iterate",
    body: "Open the URL once and walk away. Each time the agent publishes a new Revision, every open viewer swaps to it on its own. No manual refresh, no polling. Watch a render evolve as the agent works, then hand the same link to a human or another agent when it lands. Works on the dashboard and on a shared Access Link.",
  },
  {
    title: "One ID, every surface",
    body: "The Artifact ID the CLI prints is the same string the REST API returns, an MCP tool consumes, and the dashboard renders. No translation tables, no per-tool bookkeeping.",
  },
  {
    title: "Transient by default",
    body: "Artifacts expire on a TTL you choose. Share a Revision through a revocable Access Link, and revoke it later without deleting the underlying Artifact. A handoff, not a vault.",
  },
  {
    title: "Publish with zero setup",
    body: "An agent with no account can publish: `npx @zaks-io/agent-paste publish ./report --ephemeral` skips login and keys entirely. The result lives for 24 hours and prints a one-time claim link; open it signed in to keep the Artifact in your workspace.",
  },
  {
    title: "Sign in once, no keys to wrangle",
    body: "`npx @zaks-io/agent-paste login` runs a browser OAuth flow and provisions its own scoped key, stored on your machine. No token to copy, paste, or rotate by hand.",
  },
  {
    title: "Install in one line",
    body: "No Node? Grab the standalone binary: `curl -fsSL https://agent-paste.sh/install.sh | sh`. It verifies the download against the release `SHA256SUMS` and installs `agent-paste` to `~/.local/bin`. On Windows: `irm https://agent-paste.sh/install.ps1 | iex`.",
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
      { label: "Docs", href: "/docs" },
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
      { label: "/llms-full.txt", href: "/llms-full.txt" },
    ],
  },
  {
    heading: "Install",
    links: [
      { label: "install.sh", href: "/install.sh" },
      { label: "install.ps1", href: "/install.ps1" },
    ],
  },
  {
    heading: "Project",
    links: [
      { label: "About", href: "/about" },
      { label: "How it works", href: "/how-it-works" },
    ],
  },
  {
    heading: "Legal",
    links: [
      { label: "Terms", href: "/terms" },
      { label: "Privacy", href: "/privacy" },
      { label: "Data protection", href: "/privacy#data-storage-and-protection" },
    ],
  },
];
