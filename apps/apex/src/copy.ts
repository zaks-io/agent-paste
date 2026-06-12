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

export const TITLE = "agent-paste.sh: tell your agent where to publish";
export const META_DESCRIPTION =
  "Tell your agent what to make and where to post it: agent-paste.sh. It reads the docs, uses CLI or MCP, and returns a revocable Access Link. No deploy, repo, or manual upload.";

// The headline itself is canonical JSX in HomePage.tsx (it carries the one
// accent span, which a plain string can't), so it is intentionally not stored
// here. This object holds only the eyebrow, the lead, and the primary CTA.
export const HERO = {
  eyebrow: "Where agents publish",
  lead: "Tell your agent what to make and where to post it: agent-paste.sh. It reads the docs, uses CLI or MCP, and gives you an Access Link you can open on your phone or hand to the next agent.",
  primary: { label: "Open the dashboard", href: SIGN_IN_URL },
};

// One source for every CLI command string on the page, so the command boxes and
// install block can't drift. The demo TRANSCRIPT intentionally shows the agent
// workflow instead of a command for the human to run.
export const CLI = "npx @zaks-io/agent-paste";
export const LOGIN_CMD = `${CLI} login`;
export const PUBLISH_CMD = `${CLI} publish ./report`;
export const INSTALL_SH_CMD = "curl -fsSL https://agent-paste.sh/install.sh | sh";
export const INSTALL_PS1_CMD = "irm https://agent-paste.sh/install.ps1 | iex";

// The home demo: a flat, hairline transcript shell showing an agent publish
// session (style-guide §8.1 sanctions the transcript; the terminal *look* is
// still banned). Nothing in it animates.

// The transcript prints an Access Link, while the clickable demo opens a static
// page under public/ so production data is not required. The static path must
// not collide with a PRODUCT_PREFIXES redirect (redirects.ts) or the
// TEXT_ASSET_PATHS whitelist (server.ts): `/a/` is free.
export const EXAMPLE_STATIC_PAGE_PATH = "/a/art_8KQ2WSDIEGO7XR";
export const EXAMPLE_ACCESS_LINK_URL =
  "app.agent-paste.sh/al/8KQ2WSDG07XR4T9M#AQEAAAGJk2YAAAEC9XQrStUvWxYz0123456789AbCdEfGhIjKlMnOpQrStUvWxYz0";
export const EXAMPLE_PROMPT = "Plan a weekend in San Diego and post the link to agent-paste.sh.";

export type TranscriptLine =
  | { kind: "prompt"; text: string }
  | { kind: "comment"; text: string }
  | { kind: "success"; text: string }
  | { kind: "output"; text: string }
  | { kind: "result"; url: string; href: string };

// A read-only pseudo-session: the user gives the agent the job and
// agent-paste.sh, then the agent discovers the docs, publishes, and returns the
// Access Link. Nothing here is copyable on purpose; setup commands stay below.
export const TRANSCRIPT: TranscriptLine[] = [
  { kind: "prompt", text: `agent "${EXAMPLE_PROMPT}"` },
  { kind: "output", text: "reading agent-paste.sh/agents.md..." },
  { kind: "output", text: "building itinerary, maps, photos..." },
  { kind: "output", text: "wrote ./san-diego" },
  { kind: "output", text: "published and created a Share Link" },
  { kind: "success", text: 'Posted "A weekend in San Diego" to agent-paste.sh' },
  { kind: "result", url: EXAMPLE_ACCESS_LINK_URL, href: EXAMPLE_STATIC_PAGE_PATH },
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
    body: "A person gets a browser link. An agent gets structured JSON with the file tree, metadata, and signed per-file URLs. Public sharing is explicit through revocable Access Links. The next agent reads the work instead of scraping it.",
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
