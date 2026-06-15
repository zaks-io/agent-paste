# agent-paste Marketing & Brand Guide

The strategy layer of the brand: what we believe, who we serve, what we say, and
how we sound. This is the north star for marketing, copy, launch, social, docs
intros, and any surface that speaks to the outside world.

Three documents, three jobs. Keep them in their lanes:

- **This guide** owns positioning, narrative, voice, and messaging (the why and
  the what-we-say).
- [`docs/specs/style-guide.md`](./specs/style-guide.md) owns the visual and
  interaction system (the how-it-looks). It is the source of truth for color,
  type, spacing, and components. This guide never overrides it.
- [`CONTEXT.md`](../CONTEXT.md) owns the domain vocabulary (the words). Product
  nouns like **Artifact**, **Revision**, and **Access Link** are defined there.
  Use them exactly. Honor the `Avoid:` lists.

House rule for this document and everything downstream of it: no em dashes, no
emoji, no hype words. We model our own voice.

---

## 1. The Thesis

For thirty years the web has been people publishing to people. That assumption
is now wrong.

Agents write reports, render dashboards, build prototypes, and turn out more
work in an afternoon than a team used to ship in a week. That work has nowhere
to go. It dies in a chat window, gets pasted into Slack, or rots behind a link
that broke an hour after it was made. The tools we reach for were built for a
human at a keyboard: a pastebin for a snippet, a deploy platform for an app, a
file host for a download. None of them fit a folder of generated work that needs
a human-readable URL, a machine-readable manifest, a short life, and a hard
isolation boundary because nobody wrote the contents by hand.

agent-paste is where agents publish. Point an agent at `agent-paste.sh` and it
can turn a folder into a durable, addressable **Artifact** with a revocable
**Access Link** a human can open and an **Agent View** manifest another agent can
read.

This is the bet, and it is a big one: agents are a new class of internet user,
and the internet needs a place for them to put their work. We intend to be that
place. The way infrastructure wins is not by being loud. It is by being correct,
boring in the right ways, and impossible to imagine living without. That is the
register of everything that follows. Epic, stated quietly.

---

## 2. Manifesto

> The web was built for people to publish to people. Agents publish now too.
>
> They produce work faster than anyone can review it, and that work has nowhere
> durable, addressable, or safe to live. It dies in a chat window or rots behind
> a dead link.
>
> agent-paste is where agents publish. Point an agent at `agent-paste.sh` and it
> turns a folder into an Artifact with a stable ID, an Access Link for the human
> who reads it, and an Agent View manifest for the agent that consumes it.
> Built to host work it does not trust. Built to expire by default. Built to be
> revoked in one move.
>
> We are not building a louder pastebin. We are building the publishing layer
> for an internet that agents have already started using.
>
> Quietly, and correctly.

Use the manifesto as the long-form "about" block. It is the one place the brand
is allowed to be expansive. Everywhere else, compress.

---

## 3. Brand Essence

**agent-paste is the publishing layer for agent work: a durable, addressable,
safe place for the things agents make.**

- **Personality:** precise, calm, technical, unhurried, quietly ambitious.
- **Archetype:** the infrastructure craftsperson. The team that obsesses over
  the part nobody is supposed to notice, so that it never has to be noticed.
- **The flex is restraint.** In a category full of gradient washes and the word
  "magic," our power move is to refuse the theatrics and let the product speak. We
  use one flat accent and a lot of whitespace, not a light show.

### What we are

Infrastructure. A protocol surface. Vendor-neutral. Secure by default. Transient
by design. A tool experts reach for when the easy options do not fit.

### What we are not

A pastebin. A deploy platform. A file host. A social network. An "AI-powered"
anything (the AI is our user, not our feature). We are not magical, beginner-
bait, or hype-driven. If a line would feel at home in a Series A launch tweet,
delete it.

---

## 4. Positioning

**Category:** transient artifact handoff for agents. The publishing layer for
agent-generated work products.

**Positioning statement:**

> For **developers and teams building with AI agents**, agent-paste is the
> **publishing layer for agent work**. Unlike pastebins, file hosts, and deploy
> platforms (which assume a human at a keyboard and either too little structure
> or too much), agent-paste lets an agent publish a folder as one addressable
> Artifact with a revocable Access Link and a machine-readable Agent View, served
> safely and gone when it should be.

**Frame of reference, stated plainly:** competitors each own one slice and miss
the agent loop. Pastebins and Gist are too narrow (single document, no isolation,
no manifest). File hosts have the right ephemerality but no artifact model.
Deploy platforms (Vercel, Netlify, Pages) solve too much: they want a repo, a
build, and an ongoing hosting liability. AI-native sharing (Claude Artifacts,
Canvas, v0) proves the demand but is locked to one vendor's chat.

### The four reasons to believe

These are the reasons to believe. Lead with them.

1. **A URL for humans, a manifest for agents.** Every publish returns both a
   browser view and an **Agent View**: structured JSON with the file tree and
   signed per-file URLs, so the next agent reads the work instead of scraping it.
   This is the protocol surface. We keep it stable and document it loudly.
2. **Cross-vendor handoff.** An agent in one tool can publish work that a human
   or another agent in another tool can pick up. The handoff is not locked to a
   model vendor's chat surface.
3. **Safe to host what you did not write.** Generated content is untrusted by
   construction. We serve it from an isolated **Content Origin**, from private
   storage, behind short-lived signed tokens, with platform-derived MIME types,
   a strict execution policy, a denylist, and per-artifact lockdown.
4. **Transient by default, revocable on demand.** Artifacts follow Workspace
   Auto Deletion policy. Share through a revocable **Access Link** and pull it
   back without deleting the underlying work. Agent output does not live forever
   by accident.

### The launch lead: concrete first, thesis underneath

The thesis above ("where agents publish," the neutral publishing layer) is what
we are. It is not how we open. For launch, lead with the most concrete, visceral
moment, and let the thesis be the depth a reader reaches second.

**Lead use case.** A coding agent (Claude Code, Codex) builds an HTML page, a
viz, a quick prototype. The user should not need to know the publish command.
They prompt the agent: "Plan a weekend in San Diego and post the link to
agent-paste.sh." The agent reads the docs, uses CLI or MCP, publishes the work,
and returns an **Access Link** you open and send to whoever you want: a friend, a
channel, another agent.

**Hero headline:** _Your agent built it. Open it anywhere._

**Order of entry, by environment:**

- **Prompt first.** The human gives the agent the job and `agent-paste.sh`. The
  agent reads `/agents.md`, `/llms.txt`, or the docs and handles publishing.
- **CLI when the agent has a shell.** Claude Code, Codex, Cursor, CI, and remote
  sandbox agents can run the command themselves after browser login or with an
  API key.
- **MCP when the agent has no shell.** For web chats with no terminal (ChatGPT,
  Claude, Gemini): connect the MCP server once and the agent publishes, reads,
  and creates Share Links from there. MCP is the mechanism, never the headline.
  Do not lead marketing with "MCP server"; lead with what it lets someone do.

Naming those tools as supported environments is not "agent-paste for ChatGPT"
(anti-pattern 11.2). We name them as places agent-paste works, at the concrete
top of the funnel, and keep the architecture and the deeper story vendor-neutral.
The agent-to-agent, machine-readable handoff ("one ID, every surface," the
manifest as protocol) is Act 2 depth, reached after the personal hand-off, not
the opening line.

---

## 5. Audiences

The audience that makes us unusual is listed first, because it is the reason the
product exists.

Canonical product use cases live in
[`docs/specs/use-cases.md`](./specs/use-cases.md). This section owns audience
language and positioning, not a separate use-case list.

### Agents (the primary user)

Agents are literal users here. They read `/llms.txt` and `/agents.md` at request
time, publish over the CLI and MCP, and consume the Agent View. We design and
write for them as a first-class reader.

- **What they need:** a stable place to put work, and a stable way to read
  another agent's work.
- **How we serve them:** machine-readable surfaces, idempotent publishes, no
  human-only steps in the hot path.
- Agents do not pay. They are the reason anyone else does.

### Agent builders and developers (champion and first payer)

The engineer wiring an agent, a CLI, or a CI job to publish its output.

- **Pitch:** one `publish` call returns stable links. Scoped keys cap what each
  agent can do. No bucket, no build, no infra to babysit.
- **Reach:** Hacker News, X, the docs, MCP directories, the CLI itself.
- This is the first group that pays. The $5/month plan is sized to a single
  developer's willingness to pay (longer retention, more live artifacts, Live
  Updates), not to a procurement process.

### Teams (expansion payer)

Engineering and product teams adopting agents who need to know what their agents
shipped.

- **Pitch:** who published what, with which key, when it expires, and how to
  revoke or lock it down. Audit, retention, and Live Updates that follow an open
  link to the latest **Revision**.
- Deferred until the data model supports multiple members per Workspace.

### Embedders and platforms (the segment that sustains it)

Products that want artifact storage and a manifest protocol without building it.

- **Pitch:** a vendor-neutral artifact layer with a documented Agent View you can
  build on, not a feature locked to one model vendor.
- The long-term sustaining segment. Keep the architecture open to a usage-based
  tier here, even though it is not the launch focus.

---

## 6. Messaging Architecture

### 6.1 Tagline system

- **Primary (in use, keep it):** **Where agents publish.**
- **Launch hero headline (human-facing, sanctioned):** **Your agent built it.
  Open it anywhere.** The concrete entry to the same thesis (see section 4, "The
  launch lead"). Use it as the apex hero headline; keep "Where agents publish" as
  the brand line and the hero eyebrow above it. This is the deliberate hero, not
  a fifth tagline.
- **Mission line:** The publishing layer for the agent-native internet.
- **Supporting lines, by context:**
  - One publish. Every surface.
  - A URL for humans. A manifest for agents.
  - Durable, addressable artifacts for AI agents.
  - Built to host what it does not trust.

Do not introduce a fifth tagline without a reason. Repetition is how a line
becomes a brand.

### 6.2 Boilerplate

**One line:**

> agent-paste is where AI agents publish durable, shareable work products. Tell
> an agent what to make and where to post it: `agent-paste.sh`. It returns an
> Access Link for humans and a machine-readable Agent View for tools.

**Short (about-blurb):**

> agent-paste is the publishing layer for agent work. Point the agent at
> `agent-paste.sh`; it reads the docs, publishes a folder or text artifact, and
> returns a revocable Access Link a human can open plus a machine-readable
> manifest the next agent can read. Untrusted content is served from an isolated
> origin, Artifacts expire by default, and any share can be revoked without
> deleting the work.

**Long:** use the [manifesto](#2-manifesto), then the four reasons to believe
from [section 4](#the-four-things-only-we-do).

### 6.3 Value pillars (with proof)

| Pillar        | One-liner                               | Proof                                                                                          |
| ------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Dual-audience | A URL for humans, a manifest for agents | Browser view plus signed Agent View JSON with per-file URLs                                    |
| Interop       | Cross-vendor handoff                    | CLI, REST, MCP, dashboard, `/agents.md`, and `/llms.txt`                                       |
| Safe          | Safe to host what you did not write     | Isolated Content Origin, private storage, signed tokens, CSP, denylist, lockdown, audit events |
| Transient     | Gone when it should be                  | Workspace Auto Deletion policy, revocable Access Links, Access Link Lockdown                   |

### 6.4 One-liners by audience

- **Agent:** "Publish your work. Get a URL for humans and an Agent View for the
  next tool."
- **Developer:** "One publish call, scoped keys, no infrastructure. The link is
  stable and the manifest is machine-readable."
- **Team:** "Know what your agents published, share it safely, and revoke it the
  moment you need to."
- **Embedder:** "Artifact storage and a manifest protocol you can build on,
  vendor-neutral."

---

## 7. Voice & Tone

### 7.1 Principles

- **Direct.** Say what it does. State the gap between the old options and this
  one. No metaphors for features.
- **Precise without gatekeeping.** Assume competence. Explain clearly, never down.
- **Honest about scope.** Live in production, early alpha, known limits. Say so.
  A product confident enough to name its boundaries reads as more trustworthy,
  not less.
- **Calm.** Quiet confidence, not swagger. We do not dunk on incumbents, chase
  trends, or use exclamation points in product voice. The conviction is in the
  claim, not the volume.

Note: the internal team swears and argues freely. The public brand does not.
Keep the energy private and the surface composed.

### 7.2 No-hype list (banned in public copy)

revolutionary, game-changing, paradigm shift, seamless, effortless, magic /
magical, unleash, supercharge, blazing-fast, world-class, cutting-edge, next-gen,
robust, powerful, delight, empower, leverage (as a verb), simply, just, unlock,
elevate, "transform your workflow," "in today's fast-paced world," "AI-powered."

Also banned: em dashes, emoji, exclamation points in product voice, and the word
**pastebin** as a description of what we are.

### 7.3 Do / Don't

**Don't:**

```
Share your creative work with the world in just one click!
Artifacts made easy.
Enterprise-grade, AI-powered sharing for modern teams.
The GitHub for AI artifacts.
```

**Do:**

```
Publish a folder. Get a URL and an Agent View.
A URL for humans. A manifest for agents.
Built for agent output. Works for humans too.
Transient by default. Revocable on demand.
```

### 7.4 Tone by context

| Context        | Tone                                                                          |
| -------------- | ----------------------------------------------------------------------------- |
| Docs           | Precise, no redundancy, assume the reader is building                         |
| Error messages | Specific: what broke, what to try                                             |
| Marketing copy | Direct, show the gap, let the product carry it                                |
| Release notes  | What shipped, what changed, what is next. No cheerleading                     |
| Social         | Substance over snark. Share how agents should publish, not jabs at incumbents |

---

## 8. Naming & Nomenclature

- **Product name:** `agent-paste`. Lowercase, hyphenated, always. Never "Agent
  Paste," "AgentPaste," "agentpaste," or "Agent-Paste." Avoid opening a sentence
  with the name; if unavoidable, keep it lowercase rather than capitalize it.
- **Wordmark:** `agent-paste` in Cabinet Grotesk 700, `letter-spacing: -0.02em`.
  Two registered colorings only: solid foreground, or foreground with the hyphen
  in `--accent`. When the domain is shown, the `.sh` is set in `--subtle`. See
  style-guide.md section 6.2.
- **The `.sh` is part of the identity.** It signals command-line native, where
  agents and developers already live. Lean into it.
- **CLI command:** `agent-paste`, run as `npx @zaks-io/agent-paste` or installed from
  `@zaks-io/agent-paste`. The installed command is always `agent-paste`.
- **Domain terms** (Artifact, Revision, Access Link, Workspace, Agent View,
  Publish, and the rest) are proper nouns from CONTEXT.md. Capitalize them and
  respect the `Avoid:` lists. An Artifact is never a "paste," "post," or "blob."
  A Revision is never a "version." An Access Link is never a "public link."

### Subdomain system (a brand asset in itself: clean, predictable)

| Host                         | Surface                                       |
| ---------------------------- | --------------------------------------------- |
| `agent-paste.sh`             | Marketing apex, `/llms.txt`, `/agents.md`     |
| `app.agent-paste.sh`         | Dashboard for humans                          |
| `api.agent-paste.sh`         | REST API                                      |
| `mcp.agent-paste.sh`         | MCP server                                    |
| `usercontent.agent-paste.sh` | Isolated Content Origin for untrusted content |

---

## 9. Visual Identity (brand layer)

The full system lives in [`style-guide.md`](./specs/style-guide.md) and is the
source of truth. This section states only the brand-level essentials and exists
to prevent drift. The accent is a single hot vermilion — not a flat, generic
blue.

- **Aesthetic:** flat, square, one voltage, two first-class themes. A neutral
  near-black canvas (dark) and a warm paper canvas (light), a faintly warm ink,
  depth from a surface ladder and 1px hairlines (no drop shadows), and hierarchy
  by scale — one big figure, the rest a quiet mono rail. The surface is dead flat:
  no grain, no aura, no gradient. Color appears only where it carries meaning.
  The marketing site and the dashboard are one design system (style-guide.md §0),
  not two.
- **NOT:** brutalist, terminal-themed, glassmorphism, gradient hero, neon dark
  mode, soft rounded "marketing-template," or anything that would look identical
  to the rest of the category.
- **Type:** Cabinet Grotesk (display), Switzer (UI/body), and Spline Sans Mono
  (code, IDs, URLs, timestamps). Never Inter, Geist, Space Grotesk, or system
  fonts. Self-hosted variable faces shared from `@agent-paste/brand` so web and
  the marketing site cannot drift.
- **Accent:** one color, a hot vermilion (`hsl(10 100% 54%)` on both themes).
  One flat color, never a gradient, never a second accent beside it. The accent
  means "go," "valid," "published," plus links and focus rings. It is the brand
  color, used quietly.
- **Signature interaction:** the identifier. Artifact and Revision IDs rendered
  in mono, tinted, silently copyable. The product is about addressable objects,
  so this is where design budget goes, not hero animation.
- **No decoration:** no mascots, illustrations, stock photos, AI-generated
  images, or background patterns. There is no grain texture and no hero aura — the
  surface is dead flat. Character comes from type and restraint.
- **Wordmark:** `agent-paste.sh` — `agent`/`paste` in foreground, the hyphen in
  the vermilion accent, `.sh` in subtle. The slash is never part of the mark, only
  a breadcrumb separator in chrome. Identical on both surfaces; see
  style-guide.md §6.2.
- **Social / OG cards:** type-led on the near-black canvas. Wordmark, one line,
  and either the publish transcript or a single Artifact ID. Never a floating
  product screenshot, never a logo wall.

---

## 10. Signature Proof Moments

On-brand set pieces. Each one shows the thesis instead of asserting it.

- **The agent-prompt transcript.** A user asks: "Plan a weekend in San Diego and
  post the link to agent-paste.sh." The agent reads `/agents.md`, builds the
  page, publishes through CLI or MCP (content-only and private), then runs the
  `set-visibility unlisted` step and returns the unlisted Share Link. The hero should use this.
  Keep setup commands below the proof object.
- **A live artifact that updates itself.** A shared link open in a browser that
  advances to the latest Revision the moment an agent republishes, with no
  reload. Live Updates, shown not told.
- **An agent reading `/agents.md`.** Demonstrate the dual audience: a human reads
  the page, an agent reads the same domain and acts on it.
- **The manifest as protocol.** Show the Agent View JSON beside the human view.
  Same Artifact, two readers.

---

## 11. Anti-Patterns

Things that have shown up in drafts. Do not do them.

1. **Do not say "pastebin."** It points buyers at mature free tools and shrinks
   the idea. We are artifact handoff for agents.
2. **Do not position as "GitHub / S3 / Dropbox for X."** Borrowed framing makes
   us a feature of someone else's product.
3. **Do not lean on "AI-powered."** The AI is the user, not our technology.
4. **Do not use hype words** (section 7.2). No "revolutionary," no "magic."
5. **Do not hide scope or pricing.** Say what is free, who pays, and what we do
   not do (we are not production hosting).
6. **Do not chase feature parity** with deploy platforms or file hosts. We do
   artifact handoff well. We do not do everything.
7. **Do not contradict the style guide.** No brutalism, no system fonts, no
   gradients, no second accent, no mascots.
8. **Do not snark at incumbents in public.** Substance reads as confidence;
   dunking reads as insecurity.
9. **Do not invent product facts in copy.** Use the real key format, TTL bounds,
   and limits, or omit them. Marketing that lies to engineers loses engineers.
10. **Do not imply anonymous publishing can host interactive pages.** The
    `--ephemeral` (no-account) path is static HTML only, no JS, 24h, tightly
    rate-limited. Interactive (JS) pages require the free browser login (it
    exists to rate-limit and ban, not to upsell). The "send your friend an
    interactive viz" lead is the logged-in path; keep copy honest about which
    door does what.

---

## 12. Go-to-Market Posture & Constraints

- **Business model:** open-core (Apache-2.0 lean) plus a hosted paid plan. A free
  tier to try (and for agents to use), and one paid plan at **$5/month** to start.
  Hold team and embedder/platform pricing until usage justifies them; do not
  publish a tier matrix before then.
- **Pricing is provisional.** The $5/month figure is a launch starting point set
  2026-05-26, not a committed forever-price. It is fine to state it in public copy,
  but keep the copy able to change without contradicting itself, and never imply
  permanence ("lifetime," locked-in annual rates, and so on).
- **Goal:** the platform covers its own infrastructure (a low bar, roughly
  $25 to $50/month, helped by R2's no-egress pricing). This is a self-sustaining
  product, not a growth-at-all-costs one. Let the calm posture reflect that.
- **Open-source claims are live.** The repository is public and Apache-2.0.
  Public copy may link GitHub and call the source open source, but must
  distinguish source license from hosted-service access and obligations.
- **Not production hosting.** Keep limits modest and explicit. High-traffic
  hosting belongs on a deploy platform. Saying so is a feature, not an apology.
- **Distribution follows the agents.** Be where agents run: CLI install, docs,
  `/llms.txt` and `/agents.md`, MCP, and first-party snippets for Claude Code,
  Codex, Cursor, and GitHub Actions as public adoption grows.

---

## 13. How to Use This Guide

Before anything public ships, it should pass this checklist. These are the
verifiable outcomes; if one fails, fix the copy or change the guide on purpose.

- [ ] Names the product `agent-paste` (lowercase) and uses CONTEXT.md domain
      terms correctly, honoring their `Avoid:` lists.
- [ ] Leads with one of the four reasons to believe (section 4), not a feature
      list.
- [ ] Contains zero words from the no-hype list (section 7.2). No em dashes, no
      emoji, no exclamation points in product voice.
- [ ] Never calls the product a pastebin and never uses "GitHub-for-X" framing.
- [ ] States any number (price, TTL, limit) only if it is true, or omits it.
- [ ] Visuals defer to style-guide.md: flat / square / one-voltage / two
      first-class themes, Cabinet Grotesk + Switzer + Spline Sans Mono, single
      vermilion accent, square corners, no decoration (no grain, no hero aura).
- [ ] Distinguishes open-source code from hosted-service terms whenever a public
      GitHub link or "open source" claim appears.
- [ ] If it is a hero or headline, it earns the calm: the conviction is in the
      claim, not the volume.

This guide is a north star, not a cage. The product will grow and the words will
move with it. The constant is the register: a big idea, carried quietly, and
executed correctly.
