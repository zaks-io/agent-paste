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
// still banned). The transcript animates on Execute as a progressive enhancement
// (client.ts reveals lines one by one); it renders fully static for no-JS visitors,
// crawlers, and reduced-motion.

// The transcript prints a realistic Access Link in its "Link …" output line, the
// same string a real ephemeral publish returns. The demo's payoff is an inline
// preview (a mini access-link viewer) rendered as the final beat — it does NOT
// link out to a separate page, so there is no static `/a/<id>` asset and no URL
// shown in the preview's brand bar (the real collapsed /al brand bar shows only
// the wordmark). The fragment is a realistic-looking opaque token; nothing here
// resolves to real data.
const EXAMPLE_ARTIFACT_ID = "art_8KQ2WSDIEGO7XR";
export const EXAMPLE_ACCESS_LINK_URL = `app.agent-paste.sh/al/${EXAMPLE_ARTIFACT_ID}#AQEAAAGJk2YAAAEC9XQrStUvWxYz0123456789AbCdEfGhIjKlMnOpQrStUvWxYz0`;
// The published artifact's title, shown in the success line and echoed as the
// title inside the inline preview so the two read as one artifact.
export const EXAMPLE_ARTIFACT_TITLE = "Ways you could use agent-paste";
// The handed-back link, as a browser shows it (no fragment). Used for both the
// "here's your link" line and the preview's address bar so they read as one URL.
export const PREVIEW_URL = `https://${EXAMPLE_ACCESS_LINK_URL.split("#")[0]}`;

// The body of the artifact the agent published in answer to EXAMPLE_PROMPT. The
// CONCEPT: the user's agent already knows them (memory of their real work), read the
// agent-paste docs, and reports back exactly where the product fits THEIR life —
// personalized, immediately-useful findings, not hypotheticals the visitor maps onto
// themselves. The recurring SHAPE is "we just finished some work in this thread →
// write it up → host it → hand it off once": an incident report after a fix, a
// research writeup for a teammate, a migration plan for the team. NOT durable
// reference docs / guides (agent-paste is temporary, throwaway, one-shot sharing).
// Plain "you could…" lines, each NAMED so they read as pulled from real memory, not
// the site guessing. Preview CHROME (a half-second glimpse; the real copy is the page
// sections below), so only the first couple show before the fade; one line each.
export const EXAMPLE_REPORT_ROWS = [
  "You could write up that incident as a link.",
  "You could share the research you pulled together.",
  "You could hand off the migration plan as a URL.",
  "You could send the Q3 roadmap as a link.",
];
// The personalized-discovery prompt. It leads with the memory angle on purpose: the
// agent should mine what it already knows about the user's real work and report back
// where agent-paste would actually save them time — not generic, hypothetical "ways
// to use it." This is the whole concept of the demo: your agent goes and finds the
// value FOR you. A memory-equipped agent (Claude Code, Codex, ChatGPT, etc.) makes
// it personal; a cold agent still produces useful fits. Either way the run has the
// same shape, which is all the demo shows — we never see the user's memory.
export const EXAMPLE_PROMPT =
  "Read the agent-paste.sh docs, then from what you know about my work, tell me where it would actually save me time. Give me a page I can open.";
export const EXAMPLE_PROMPT_VARIANT = "hero_agent_session_v4_conditional_memory";

// Inline run affordance shown right after the prompt line, and the replay control
// in the head once the run has played. Copy floats freely; not a test contract.
export const DEMO_RUN = {
  execute: "Execute",
  replay: "Replay",
};

export type UseCase = {
  // The recognizable situation, in the visitor's own terms.
  scenario: string;
  // The concrete payoff: the link, who opens it, what it saves them.
  outcome: string;
  // Optional real example page. Unset for now; real clickable examples are a
  // deferred follow-up, not part of this change.
  href?: string;
};

// The "is this for me" section: concrete jobs people already do, each ending in
// the link they hand off. It sits right under the demo so the feat of strength is
// immediately followed by "...and here is when that is you". Kept to four so the
// reader is not asked to weigh a wall of equal options. Defined above TRANSCRIPT
// because the inline demo preview renders these scenarios as its body rows.
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

// Each line carries `wait`: the ms of "work" that happens BEFORE it appears, so
// the cadence models where real latency actually is, not an arbitrary per-line
// tick. A thinking beat precedes reasoning; a real network wait precedes a fetch
// result; the upload/publish round-trip precedes the publish output; lines that
// are part of one result burst in with near-zero waits. client.ts reads `wait`
// directly (and scales it down for a snappy demo).
export type TranscriptLine = {
  wait?: number;
} & ( // affordance). Always visible; the inline Execute button sits under it. // The copyable prompt the visitor pastes into their own agent (the one copy
  | { kind: "prompt"; text: string }
  // First-person agent narration, the "thinking out loud" beats a real coding
  // agent prints before it acts: Claude Code's "⏺ ...". Marked with the ⏺ glyph.
  | { kind: "reason"; text: string }
  // A collapsed tool-call summary, the signature of a real Claude Code feed: the
  // tool invocation (`Fetch(...)`, `Read(...)`, `Bash(...)`) on its own line, then
  // the single-line result on a `⎿` gutter beneath it. `result` is the dim line
  // the tool returned; `hint` is the optional faint "(ctrl+o to expand)" tail.
  | { kind: "tool"; text: string; result: string; hint?: string }
  // A shell command the agent actually runs, shown with a caret.
  | { kind: "cmd"; text: string }
  // Tool/command output the agent gets back, dim and indented.
  | { kind: "output"; text: string }
  // A green success summary line.
  | { kind: "success"; text: string }
  // The returned no-login link, shown as the handed-back URL line right before the
  // preview opens below it. Not clickable (the demo opens nothing); it is the link
  // the agent reports, echoed by the preview's address bar.
  | { kind: "link"; url: string }
  // The payoff: an inline "mini access-link viewer" reveal that mirrors the real
  // /al viewer in miniature (browser address bar + bottom-left wordmark brand bar),
  // rendering the published page (`title` + `rows`) instead of linking out. `url`
  // is the access link shown in the fake address bar (no fragment).
  | { kind: "preview"; title: string; rows: string[]; url: string }
  // A trailing dim comment.
  | { kind: "comment"; text: string }
);

// A pseudo-session modeled on a real coding-agent run (Codex / Claude Code) on the
// accountless --ephemeral path: the agent states its plan, reads the docs, reasons
// from what it knows about the user, runs one real publish command, and hands back
// the no-login link. The output block
// follows the CLI's actual ephemeral publish format (apps/cli/src/publish-format.ts):
// the same labels and order (Published / Link / Expires / Upload / Claim), with the
// Claim copy trimmed for the demo. Generic enough to be any visitor's work, true to
// the real tool. The prompt line is the page's single copy affordance
// (clicking it copies the bare EXAMPLE_PROMPT); every other line is read-only.
// The animated demo (client.ts) reveals these one by one on Execute; with JS off
// every line is visible, so this is also the static fallback.
export const TRANSCRIPT: TranscriptLine[] = [
  { kind: "prompt", text: `agent "${EXAMPLE_PROMPT}"` },
  // Narrates intent before acting, the way a real Claude Code session opens: state
  // the first move and why, then do it. Not a full plan dumped up front.
  {
    kind: "reason",
    wait: 900,
    text: "I'll read the agent-paste.sh docs first, since that's the tool I'd be publishing with.",
  },
  // The signature Claude Code beat: a collapsed tool call with a `⎿` result gutter.
  // The wait is AFTER the call — the network round-trip before the result lands.
  {
    kind: "tool",
    wait: 1300,
    text: "Fetch(agent-paste.sh/llms.txt)",
    result: "the publishing layer for agent work · CLI + MCP · accountless --ephemeral publish",
    hint: "+18 lines (ctrl+o to expand)",
  },
  // Draws on what it already knows about the user, as a plain thought, NOT a tool
  // call: real agents reason from context they hold (project memory, the session),
  // there is no universal "memory file" to read, so asserting a Read(...) of one
  // would ring false to the savvy visitor. Conditional by design: a memory-equipped
  // agent has real context here; a cold agent has none and the same line reads as
  // common patterns. The demo only shows the shape.
  {
    kind: "reason",
    wait: 800,
    text: "From what I know about your work: research briefs, agent handoffs, dashboards you can't open without a server.",
  },
  // States the conclusion in one beat (not a 3-line dump) and commits to the build.
  {
    kind: "reason",
    wait: 700,
    text: "Three clear fits. I'll write them up and publish with no login so you can just open it.",
  },
  // Runs the one real command. The wait AFTER it is the upload + publish round-trip
  // before the CLI output block returns.
  { kind: "cmd", wait: 700, text: "agent-paste publish ./report --ephemeral" },
  // The real CLI ephemeral output block (publish-format.ts: success → Link →
  // Expires → Upload → Claim), bursting in together.
  { kind: "success", wait: 1900, text: `Published "${EXAMPLE_ARTIFACT_TITLE}"` },
  { kind: "output", wait: 250, text: `Link     ${EXAMPLE_ACCESS_LINK_URL.split("#")[0]}…` },
  // Relative, not a literal date: the real CLI prints a calendar date, but a
  // hardcoded one ages out of the demo. "in 24 hours" is truthful to the ephemeral
  // TTL and never goes stale.
  { kind: "output", wait: 180, text: "Expires  in 24 hours" },
  { kind: "output", wait: 180, text: "Upload   1/1 uploaded, 0 reused · 11.8 KB sent, 0 B cached" },
  { kind: "output", wait: 220, text: "Claim    log in and open to keep it and make it interactive" },
  // The handoff: narrate, hand back the link line, then open the preview below it.
  { kind: "reason", wait: 700, text: "Done. Here's your link, no login needed:" },
  { kind: "link", wait: 350, url: PREVIEW_URL },
  // The rows are the agent's published report (EXAMPLE_REPORT_ROWS): concrete ways
  // to use agent-paste, in the agent's voice answering the prompt. The address-bar
  // URL is the same access link (no fragment), the way a browser shows it.
  {
    kind: "preview",
    wait: 250,
    title: EXAMPLE_ARTIFACT_TITLE,
    rows: EXAMPLE_REPORT_ROWS,
    url: PREVIEW_URL,
  },
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
