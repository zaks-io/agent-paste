// Cross-app base URLs are baked at prerender time from the env apex is built for
// (AGENT_PASTE_ENV, set per env in wrangler.jsonc and passed through by the deploy
// layer the same way BILLING_ENABLED is). On the preview deploy this points every
// CTA / dashboard / API link at the preview app, not production. Defaults to
// production so a bare/unknown build is correct.
const ENV = (typeof process !== "undefined" ? process.env.AGENT_PASTE_ENV : undefined) ?? "production";
const SUBDOMAIN_PREFIX = ENV === "preview" ? "preview." : "";

export const APP_BASE_URL = `https://app.${SUBDOMAIN_PREFIX}agent-paste.sh`;
// The app has no /login route; sign-in is initiated at /api/auth/sign-in
// (root "/" also redirects there for unauthenticated visitors).
export const SIGN_IN_URL = `${APP_BASE_URL}/api/auth/sign-in`;
export const API_BASE_URL = `https://api.${SUBDOMAIN_PREFIX}agent-paste.sh`;
export const MCP_BASE_URL = `https://mcp.${SUBDOMAIN_PREFIX}agent-paste.sh`;
export const SOURCE_REPOSITORY = {
  label: "View on GitHub",
  slug: "zaks-io/agent-paste",
  href: "https://github.com/zaks-io/agent-paste",
};

export const WORDMARK = {
  base: "agent-paste",
  tld: ".sh",
};

export const TITLE = "agent-paste.sh: your agent built it, open it anywhere";
export const META_DESCRIPTION =
  "Your coding agent built an HTML report or page. agent-paste turns it into a link you can open and share, in one command. No deploy, no repo, no API keys. It works from Claude Code, Codex, or any shell, and over MCP from a web chat that has none. One Artifact ID resolves the same across the CLI, REST API, MCP, and dashboard.";

export const HERO = {
  eyebrow: "Where agents publish",
  headline: "Your agent built it. Open it anywhere",
  lead: "Claude Code or Codex builds an interactive page. One command turns it into a link you can open on your phone, share with anyone, or hand to the next agent. Log in once in the browser, free, no API keys, and the agent handles the rest.",
  primary: { label: "Open the dashboard", href: SIGN_IN_URL },
  secondary: { label: "Read the docs", href: "/docs" },
};

export type Feature = {
  title: string;
  // Body prose; `backtick` spans render as inline <code> (see renderFeature).
  body: string;
};

export const FEATURES: Feature[] = [
  {
    title: "Leave the tab open, watch it iterate",
    body: "Open the URL once and walk away. Each time the agent publishes a new Revision, every open viewer swaps to it on its own. No manual refresh, no polling. Watch a render evolve as the agent works, then hand the same link to a human or another agent when it lands. Works on the dashboard and on a shared Access Link.",
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
    title: "Cross-vendor by design",
    body: "An artifact made inside one tool stays walled in. Vendor surfaces are auth-locked with no machine-readable handoff out. agent-paste is the neutral layer in between: an agent in any tool publishes, a human or another agent in any other tool picks it up.",
  },
  {
    title: "A URL and an Agent View",
    body: "Publish returns a browser URL for people and an Agent View JSON manifest for tools: file tree, metadata, signed per-file URLs, and Bundle Availability. No scraping, no per-tool export path.",
  },
  {
    title: "Transient by default",
    body: "Artifacts expire under your Workspace's Auto Deletion policy. Share a Revision through a revocable Access Link, and revoke it later without deleting the underlying Artifact. A handoff, not a vault.",
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

// Direct links to the standalone install scripts. Agents need them in the DOM,
// but they are not a human destination, so they live in the deprioritized base
// row rather than as a headline footer column.
export const INSTALL_LINKS: { label: string; href: string }[] = [
  { label: "install.sh", href: "/install.sh" },
  { label: "install.ps1", href: "/install.ps1" },
];

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
    heading: "Project",
    links: [
      { label: "About", href: "/about" },
      { label: "How it works", href: "/how-it-works" },
      { label: SOURCE_REPOSITORY.label, href: SOURCE_REPOSITORY.href },
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
