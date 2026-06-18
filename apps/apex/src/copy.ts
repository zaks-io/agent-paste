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
// The search-result snippet (and JSON-LD via structured-data.ts; also the social
// og:description). Human-first: the pain (work stuck in chat), the payoff (a link
// to open and share). Must stay <= 125 chars (render.test.tsx crawler-card cap).
export const META_DESCRIPTION =
  "Your agent built it and it is stuck in a chat window. agent-paste turns it into a link you can open and share.";

// The headline itself is canonical JSX in HomePage.tsx (it carries the one
// accent span, which a plain string can't), so it is intentionally not stored
// here. This object holds the eyebrow, the lead, the honest status line, and the
// secondary dashboard link.
export const HERO = {
  eyebrow: "Where agents publish",
  // The lead answers a cold visitor's first two questions (what is this, is it for
  // me) in plain, human terms before any mechanism. Concrete nouns let the reader
  // self-identify; "trapped in a chat window" is the felt pain; the closing clause
  // is the whole how-to, deliberately last, pointing at the funnel. This page is
  // human-facing marketing: agents read /agents.md and /llms.txt, not this. The
  // shell / login / --ephemeral mechanism lives below the fold.
  lead: "Your AI agent built a report, a dashboard, a prototype, and it is trapped in a chat window. agent-paste turns it into a link you can open in any browser and send to anyone. Tell your agent to publish it; you get the link.",
  // Honest, verifiable, and answers the two first-glance objections (is this real?
  // what is the catch on free?). Every figure is true to packages/config + pricing.
  status:
    "Early alpha. No card. Unclaimed links last 24 hours with scripts disabled; free accounts keep work longer and unlock interactive pages.",
  // The dashboard is the secondary door, not the headline ask.
  secondary: { label: "Open the dashboard", href: SIGN_IN_URL },
};

// The repository is public and Apache-2.0; surfacing that verifiable fact in the
// hero is the only honest "trust signal" available (no fabricated counts).
export const SOURCE_BADGE_LABEL = `Apache-2.0 · ${SOURCE_REPOSITORY.slug}`;

// One source for every CLI command string on the page, so the command boxes and
// install block can't drift. The demo TRANSCRIPT intentionally shows the agent
// workflow instead of a command for the human to run.
export const CLI = "npx @zaks-io/agent-paste";
export const LOGIN_CMD = `${CLI} login`;
export const PUBLISH_CMD = `${CLI} publish ./report`;
// The accountless front door: publishes with no login and hands back a working
// no-login link. Claiming to keep and upgrade it is a separate later step.
export const PUBLISH_EPHEMERAL_CMD = `${CLI} publish ./report --ephemeral`;
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
export const EXAMPLE_PROMPT = "Build a one-page project handoff, publish it with agent-paste.sh, and give me the link.";
export const EXAMPLE_PROMPT_VARIANT = "hero_agent_session_v1";

export type TranscriptLine =
  | { kind: "prompt"; text: string }
  | { kind: "comment"; text: string }
  | { kind: "success"; text: string }
  | { kind: "output"; text: string }
  | { kind: "result"; url: string; href: string };

// A pseudo-session: the user gives the agent the job and agent-paste.sh, then the
// agent discovers the docs, publishes, and returns the Access Link. The first
// prompt line is the page's single copy affordance (clicking it copies the bare
// EXAMPLE_PROMPT to paste into your own agent); every other line is read-only.
export const TRANSCRIPT: TranscriptLine[] = [
  { kind: "prompt", text: `agent "${EXAMPLE_PROMPT}"` },
  { kind: "output", text: "reading agent-paste.sh/agents.md..." },
  { kind: "output", text: "building project handoff..." },
  { kind: "output", text: "wrote ./handoff" },
  { kind: "output", text: "published and created a Share Link" },
  { kind: "success", text: 'Posted "Project handoff" to agent-paste.sh' },
  { kind: "result", url: EXAMPLE_ACCESS_LINK_URL, href: EXAMPLE_STATIC_PAGE_PATH },
  { kind: "comment", text: "# open it now or share it. ask to claim it when you want it kept and interactive." },
];

export type Feature = {
  title: string;
  // Body prose; `backtick` spans render as inline <code> (see renderFeature).
  body: string;
};

// The four reasons the link holds up, framed as what the reader gets, not the
// mechanism. Per the human-first rule for this page, each title and first line
// speak to a person; the protocol / safety detail follows in the body, for the
// dev who reads on. The OAuth-login and ephemeral facts live where the page shows
// them (the command boxes and the closing block).
export const FEATURES: Feature[] = [
  {
    title: "One link, opens anywhere",
    body: "Hand it to a person or pass it to another agent. People get a clean View in the browser; agents get an Agent View, structured JSON with the file tree, metadata, and signed per-file URLs, so the next agent reads the work instead of scraping it. One stable Artifact, the same across CLI, MCP, and the dashboard.",
  },
  {
    title: "Move work between tools that don't talk",
    body: "Work made inside one tool stays walled in: vendor surfaces are auth-locked with no machine-readable way out. agent-paste is the neutral layer between them. An agent in Cursor publishes; a teammate in ChatGPT, or you in a browser, picks it up.",
  },
  {
    title: "The link stays current, until you cut it",
    body: "Leave the link open and every viewer advances to the newest Revision on its own, no reload, no re-send. Share through a revocable Access Link and pull it back any time without deleting the work. Artifacts expire under your Workspace Auto Deletion policy: a handoff, not a vault.",
  },
  {
    title: "Safe to open what your agent wrote",
    body: "Generated pages are untrusted by construction, so they run from an isolated Content Origin: private storage, short-lived signed tokens, platform-derived MIME types, a strict execution policy, and per-artifact lockdown. You can host what an agent generated without it touching your account.",
  },
];

export type UseCase = {
  // The recognizable situation, in the visitor's own terms.
  scenario: string;
  // The concrete payoff: the link, who opens it, what it saves them.
  outcome: string;
  // Optional real example page (a static /a/<id>/ artifact). Unset for now; real
  // clickable examples are a deferred follow-up, not part of this change.
  href?: string;
};

// The "is this for me" section: concrete jobs people already do, each ending in
// the link they hand off. It sits right under the demo so the feat of strength is
// immediately followed by "...and here is when that is you". Kept to four so the
// reader is not asked to weigh a wall of equal options.
export const USE_CASES: UseCase[] = [
  {
    scenario: "Your agent wrote a research brief or analysis you need to send up.",
    outcome:
      "Hand your boss a link, not a 4,000-line chat scroll. It opens in any browser, formatted, no tool of theirs required.",
  },
  {
    scenario: "You built something in one agent and the next person lives in another.",
    outcome:
      "Publish from Cursor, and a teammate on ChatGPT or Claude reads the work instead of re-deriving it. The handoff carries the files, not a copy-paste.",
  },
  {
    scenario: "The agent keeps revising and people already have the link.",
    outcome:
      "Everyone you sent it to sees the newest version on their own, no reload and no re-send. One stable link for the whole back-and-forth.",
  },
  {
    scenario: "Your agent generated a page that is meant to actually run.",
    outcome:
      "A self-contained dashboard or interactive report runs from a safe, isolated origin, so you can open what the agent wrote without standing up a server.",
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
