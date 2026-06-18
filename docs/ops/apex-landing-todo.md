# Apex landing page todo

Follow-ups from the 2026-06-17 above-the-fold rewrite (branch `apex-why-first-copy`).

## Context

A real visitor bounced off the live site: _"I must not be in the industry. I just
don't understand what this is for."_ Root cause: the hero led with a how-to
instruction ("Paste this into a shell-capable agent...") before answering the cold
visitor's first two questions (what is this / is it for me). The rewrite leads with
the human pain ("trapped in a chat window") and payoff ("a link you can open and
send to anyone"), drops the redundant `heroAction` directive, adds a "When you'd
reach for it" use-cases block under the demo, reframes the four reasons to benefit
titles, and stops the static example page from captioning itself as fake. This page
is human-focused marketing; agents read `/agents.md` and `/llms.txt`, not this.

Validated with a 3-lens adversarial review (cold visitor, ICP developer, brand
enforcer). All three ranked the old hero last; all three pass the rewrite. The
findings below are what the re-review surfaced as still open.

## Open follow-ups

1. **Live feat-of-strength (highest leverage for the dev ICP).** The demo is still a
   hardcoded transcript whose result link goes to a static page under
   `apps/apex/public/a/art_8KQ2WSDIEGO7XR/`. The page asserts the dual-audience wedge
   ("agents get an Agent View, structured JSON with the file tree, metadata, and
   signed per-file URLs") but never _shows_ it. The single highest-impact change is
   to publish a real Artifact and surface its Agent View JSON (file tree + signed
   per-file URLs) on the landing page as above-the-fold proof, ideally a
   generated-HTML-with-script artifact so the isolation claim is concrete too. This
   was deferred from the rewrite because it needs a real published example + demo
   wiring (data provisioning, caching, Content Origin), not just copy. It should be
   the next apex change, not a someday item: the most differentiated claim on the
   page is the one a skeptic cannot verify by clicking.

2. **`EXAMPLE_ACCESS_LINK_URL` is a fabricated, non-resolving string** (`copy.ts`).
   It is presented as a real Access Link in the transcript but hrefs to the static
   page. Folds into follow-up 1 (a real artifact gives a real Access Link). Until
   then, it is the kind of dead detail a skeptical dev checks.

3. **Headline word "agent" may make a casual ChatGPT/Claude user self-disqualify.**
   The cold-visitor lens flagged that "Your agent built it" can read as "for the
   AI-engineer crowd" to someone who thinks of themselves as "just using ChatGPT,"
   the exact audience the page is for. The headline is sanctioned (brand guide 6.1)
   so it is not changed unilaterally; worth an A/B test of a wider-door variant
   (e.g. "Your AI built it") with marketing/brand owner sign-off.

4. **Harden the apex banned-token test to the full 7.2 no-hype list.** The rewrite
   originally shipped "your AI agent _just_ built..."; "just" is on the brand guide
   7.2 no-hype list and was removed by hand. The test in `render.test.tsx`
   ("keeps buzzword claims and em dashes out") only checks a handful of words on one
   page. Extend it to the full list with word-boundary matching (so it does not
   false-positive on "adjust"/"justify") and run it over the home page body too, so
   a banned word can't slip back in.

5. **Doc-friction: brand guide vs. live copy had drifted.** The brand guide's
   launch-lead section (concrete-first, "Your agent built it. Open it anywhere.")
   and the live `copy.ts` hero (mechanism-first "Paste this into a shell-capable
   agent...") had diverged. The rewrite reconciles them, but confirm the guide and
   the page stay in sync, and treat the guide's launch-lead as the source of truth
   for future hero edits.
