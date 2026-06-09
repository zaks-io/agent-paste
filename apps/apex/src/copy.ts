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

// The headline itself is canonical JSX in HomePage.tsx (it carries the one
// accent span, which a plain string can't), so it is intentionally not stored
// here. This object holds only the eyebrow, the lead, and the primary CTA.
export const HERO = {
  eyebrow: "Where agents publish",
  lead: "Claude Code or Codex builds an interactive page. One command turns it into a link you open on your phone, send to anyone, or hand to the next agent. Sign in once in the browser, free, and the agent does the rest.",
  primary: { label: "Open the dashboard", href: SIGN_IN_URL },
};

// One source for every CLI command string on the page, so the demo, the command
// boxes, and the install block can't drift. The demo TRANSCRIPT keeps its own
// `publish ./san-diego` line (that exact string is a tested contract); every
// other publish example uses the generic `./report`.
export const CLI = "npx @zaks-io/agent-paste";
export const LOGIN_CMD = `${CLI} login`;
export const PUBLISH_CMD = `${CLI} publish ./report`;
export const INSTALL_SH_CMD = "curl -fsSL https://agent-paste.sh/install.sh | sh";
export const INSTALL_PS1_CMD = "irm https://agent-paste.sh/install.ps1 | iex";

// The home demo: a flat, hairline transcript shell showing one real publish
// session (style-guide §8.1 sanctions the transcript; the terminal *look* is
// still banned). Nothing in it animates.

// The static demo artifact the transcript resolves to. It is a self-hosted
// static page under public/ (NOT a live artifact), served at an id-shaped path
// so the URL reads like a real minted Artifact. The slug must not collide with a
// PRODUCT_PREFIXES redirect (redirects.ts) or the TEXT_ASSET_PATHS whitelist
// (server.ts): `/a/` is free.
export const EXAMPLE_ARTIFACT_PATH = "/a/art_8KQ2WSDIEGO7XR";
export const EXAMPLE_ARTIFACT_URL = `agent-paste.sh${EXAMPLE_ARTIFACT_PATH}`;
export const EXAMPLE_PROMPT = "plan me a weekend in San Diego";

export type TranscriptLine =
  | { kind: "prompt"; text: string }
  | { kind: "comment"; text: string }
  | { kind: "success"; text: string }
  | { kind: "output"; text: string }
  | { kind: "result"; url: string; href: string };

// A read-only pseudo-session: the agent builds a folder, then one full publish
// command turns it into a shareable link. The success + result lines are a
// truthful slice of what the CLI's formatPublishResult actually prints (see
// apps/cli/src/index.ts), so the demo never fabricates output. Nothing here is
// copyable on purpose; it shows what happens, and the runnable command lives in
// the CommandBox below the shell.
export const TRANSCRIPT: TranscriptLine[] = [
  { kind: "prompt", text: `agent "${EXAMPLE_PROMPT}"` },
  { kind: "output", text: "building itinerary, maps, photos..." },
  { kind: "output", text: "wrote ./san-diego" },
  { kind: "prompt", text: 'npx @zaks-io/agent-paste publish ./san-diego \\\n    --title "A weekend in San Diego"' },
  { kind: "success", text: 'Published "A weekend in San Diego"' },
  { kind: "result", url: EXAMPLE_ARTIFACT_URL, href: EXAMPLE_ARTIFACT_PATH },
  { kind: "comment", text: "# open it on your phone, share it, or hand it to the next agent." },
];

export type Feature = {
  title: string;
  // Body prose; `backtick` spans render as inline <code> (see renderFeature).
  body: string;
};

// The four reasons the link holds up, one per brand-guide reason to believe.
// Deduped from an earlier seven-item wall: the OAuth-login and ephemeral facts
// now live where the page shows them (the command boxes and the closing block),
// and Live Update folds into the transient/Access Link reason it belongs to.
export const FEATURES: Feature[] = [
  {
    title: "A URL for humans. A manifest for agents.",
    body: "Every Publish returns a browser URL a person opens and an Agent View: structured JSON with the file tree, metadata, and signed per-file URLs. The next agent reads the work instead of scraping it. One stable Artifact ID, the same across CLI, REST, MCP, and the dashboard.",
  },
  {
    title: "Cross-vendor handoff",
    body: "Work made inside one tool stays walled in: vendor surfaces are auth-locked with no machine-readable way out. agent-paste is the neutral layer between them. An agent in any tool publishes; a human or another agent in any other tool picks it up.",
  },
  {
    title: "Transient by default, revocable on demand",
    body: "Artifacts expire under your Workspace Auto Deletion policy. Share a Revision through a revocable Access Link, then revoke it without deleting the underlying Artifact. Leave the link open and every viewer advances to the newest Revision on its own, no reload. A handoff, not a vault.",
  },
  {
    title: "Safe to host what your agent wrote",
    body: "Generated pages are untrusted by construction, so they run from an isolated Content Origin: private storage, short-lived signed tokens, platform-derived MIME types, a strict execution policy, and per-artifact lockdown.",
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
