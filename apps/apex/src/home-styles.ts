// Marketing CSS for the whole apex surface. The home page is the full-bleed
// OpenNote-shaped layout (sticky topbar, centered hero with the brand mark as
// art, a terminal-window transcript, a "who it's for" grid, pillars, a publish
// diagram, a feature grid, a closing CTA); docs/about/legal reuse the same
// topbar/footer and atmosphere but render their content in the constrained
// `.page-body` column. Every apex page sets `<body class="home">` and gets this
// stylesheet (see chrome.tsx), so all rules are `.home`-scoped.
//
// Discipline (unified with the dashboard, see docs/specs/style-guide.md): one
// shared token system, square corners (--radius-xs/sm/md), depth from the surface
// ladder + 1px hairlines — no decorative drop shadows, no accent glows, no card
// hover-lifts, no gradient fills. The single permitted atmospheric exception is
// the faint hero aura in HOME_ATMOSPHERE, which must stay below "legible" like the
// grain. The sticky topbar's scroll-state backdrop-filter is the same treatment
// the web Topbar uses, so it stays.

const HOME_TOKENS = `.home {
  --container-home: 1080px;
  /*
   * Floor at 40px so a 375px phone gets a calm headline, not the 54px desktop
   * display size crammed into three tight lines. The 10vw slope still reaches
   * the 104px cap by ~1040px.
   */
  --text-hero-home: clamp(40px, 10vw, 104px);
}`;

const HOME_ATMOSPHERE = `.home {
  position: relative;
  min-height: 100svh;
  display: flex;
  flex-direction: column;
}

/* Keep the footer pinned to the bottom on short pages (e.g. sparse doc routes);
   the page-body grows to fill the gap between the sticky header and footer. */
.home .page-body {
  flex: 1 0 auto;
}

/* Faint violet aura behind the hero: one soft radial, not a gradient fill. */
.home::before {
  content: "";
  position: fixed;
  top: -22vh;
  left: 50%;
  transform: translateX(-50%);
  width: min(1100px, 120vw);
  height: 760px;
  z-index: 0;
  pointer-events: none;
  background: radial-gradient(50% 50% at 50% 40%, hsl(var(--accent) / 0.16), transparent 70%);
  filter: blur(8px);
}

.home > * {
  position: relative;
  z-index: 1;
}`;

const HOME_LAYOUT = `.home .wrap {
  max-width: var(--container-home);
  margin-inline: auto;
  padding-inline: 24px;
}

@media (min-width: 720px) {
  .home .wrap {
    padding-inline: 40px;
  }
}`;

// Constrained reading column for the non-bleed pages (docs/about/legal) now that
// they share the full-bleed marketing chrome. Mirrors the width and padding the
// retired .page grid provided so prose keeps a readable measure.
const HOME_PAGEBODY = `.home .page-body {
  max-width: var(--container);
  margin-inline: auto;
  padding: 48px 24px 72px;
}

@media (min-width: 640px) {
  .home .page-body {
    padding: 64px 40px 96px;
  }
}`;

const HOME_TOPBAR = `.topbar {
  position: sticky;
  top: 0;
  z-index: 50;
  border-bottom: 1px solid transparent;
  transition: background 200ms var(--ease-out), border-color 200ms var(--ease-out), backdrop-filter 200ms;
}

.topbar[data-stuck="true"] {
  background: hsl(var(--background) / 0.72);
  backdrop-filter: blur(14px) saturate(140%);
  border-bottom-color: hsl(var(--rule));
}

.topbar-inner {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  column-gap: 12px;
  height: 64px;
}

@media (min-width: 880px) {
  .topbar-inner { height: 68px; }
}

.topbar .brand {
  justify-self: start;
}

.topbar .brand-mark {
  width: 24px;
  height: 24px;
  border-radius: var(--radius-sm);
}

.head-center {
  display: none;
  justify-self: center;
  align-items: center;
  gap: 4px;
}

@media (min-width: 880px) {
  .head-center {
    display: inline-flex;
  }
}

.head-center .head-link {
  font-family: var(--font-mono);
  font-size: 12.5px;
  color: hsl(var(--muted));
  padding: 7px 12px;
  border-radius: var(--radius-md);
  transition: color 120ms var(--ease-out), background 120ms var(--ease-out);
}

.head-center .head-link:hover {
  color: hsl(var(--foreground));
  background: hsl(var(--surface-2));
}

.head-end {
  justify-self: end;
  display: inline-flex;
  align-items: center;
  gap: 10px;
}`;

// Home buttons add the trailing accent node on hover and a slightly taller scale
// than the dashboard's. Kept under .home so the docs/legal buttons stay as-is.
const HOME_BUTTONS = `.home .button-lg {
  height: 46px;
  padding-inline: 24px;
  font-size: 15px;
}

.home .button::after {
  height: 5px;
}

.button-accent {
  background: hsl(var(--accent));
  color: hsl(var(--accent-fg));
}

.button-accent:hover {
  background: hsl(var(--accent-dim));
}

/* Secondary action as a link with a trailing arrow, not an equal-weight button. */
.button-link-lg {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 46px;
  padding-inline: 8px;
  font-weight: 500;
  font-size: 15px;
  color: hsl(var(--muted));
  border: 0;
  background: transparent;
  cursor: pointer;
  transition: color 120ms var(--ease-out);
}

.button-link-lg::after {
  content: "→";
  color: hsl(var(--accent));
  transition: transform 140ms var(--ease-out);
}

.button-link-lg:hover {
  color: hsl(var(--foreground));
}

.button-link-lg:hover::after {
  transform: translateX(3px);
}`;

const HOME_HERO = `.home-hero {
  text-align: center;
  padding-top: clamp(48px, 9vw, 110px);
  padding-bottom: clamp(40px, 6vw, 72px);
}

.hero-art {
  position: relative;
  width: clamp(92px, 12vw, 132px);
  height: clamp(92px, 12vw, 132px);
  margin: 0 auto 34px;
}

.hero-art img {
  width: 100%;
  height: 100%;
  display: block;
  border-radius: var(--radius-md);
  border: 1px solid hsl(var(--rule));
}

.home-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: hsl(var(--subtle));
  margin-bottom: 22px;
}

.home-eyebrow .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: hsl(var(--success));
  animation: home-live-pulse 2.4s var(--ease-out) infinite;
}

@keyframes home-live-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.home-hero-headline {
  font-family: var(--font-ui);
  font-optical-sizing: auto;
  font-size: var(--text-hero-home);
  font-weight: 700;
  line-height: 1.0;
  letter-spacing: -0.03em;
  font-variation-settings: "opsz" 40;
  font-feature-settings: "ss01", "tnum";
  color: hsl(var(--foreground));
  max-width: 16ch;
  margin: 0 auto;
  text-wrap: balance;
}

/* Tighten leading and tracking back up once the type is large enough to carry it. */
@media (min-width: 720px) {
  .home-hero-headline {
    line-height: 0.94;
    letter-spacing: -0.04em;
  }
}

.home-hero-headline .stop {
  color: hsl(var(--accent));
}

.home-hero-lead {
  font-size: clamp(16px, 1.25vw, 19px);
  line-height: 1.6;
  color: hsl(var(--muted));
  max-width: 56ch;
  margin: 26px auto 0;
}

.home-hero-actions {
  display: inline-flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 12px;
  margin-top: 34px;
}`;

const HOME_TRANSCRIPT = `.transcript-stage {
  padding-bottom: clamp(48px, 7vw, 96px);
}

.transcript-shell {
  max-width: 760px;
  margin: 0 auto;
  background: hsl(var(--surface));
  border: 1px solid hsl(var(--rule));
  border-radius: var(--radius-md);
  overflow: hidden;
}

.transcript-bar {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 11px 16px;
  border-bottom: 1px solid hsl(var(--rule));
  background: hsl(var(--surface-2));
}

.tl-dots {
  display: inline-flex;
  gap: 7px;
}

.tl-dots i {
  width: 11px;
  height: 11px;
  border-radius: 50%;
  background: hsl(var(--surface-3));
  box-shadow: inset 0 0 0 1px hsl(var(--rule-strong));
}

.tl-title {
  font-family: var(--font-mono);
  font-size: 12px;
  color: hsl(var(--subtle));
}

.home .transcript {
  margin: 0;
  padding: 16px 16px;
  font-family: var(--font-mono);
  font-feature-settings: "zero";
  font-size: 12px;
  line-height: 1.7;
  font-weight: 400;
  white-space: normal;
  color: hsl(var(--foreground));
  text-align: left;
  background: transparent;
  border: 0;
  border-radius: 0;
}

/*
 * Each transcript line is its own wrapping block with a hanging indent, so a
 * command or URL too wide for a phone wraps cleanly and its continuation tucks
 * under the start of the line instead of soft-wrapping mid-token or centering.
 * This reads as a real terminal at any width, no horizontal scroll. The literal
 * newlines between lines collapse (white-space: normal) since each .t-line is a
 * block; the extra leading comes from the per-line margin below.
 */
.home .transcript .t-line {
  display: block;
  margin-block: 0.5em;
  overflow-wrap: break-word;
}
.home .transcript .t-line:first-child { margin-top: 0; }

/*
 * Gutter lines (prompt $, result gesture, success check) lay out as a flex row: a
 * fixed, non-shrinking glyph column, then the command/URL/text wrapping in the
 * remaining space. min-width:0 lets the long token actually wrap instead of
 * forcing overflow, and the glyph stays pinned at the top-left of its line.
 */
.home .transcript .t-gutter {
  display: flex;
  align-items: baseline;
  gap: 0.6em;
}
.home .transcript .t-gutter > .t-prompt,
.home .transcript .t-gutter > .t-gesture,
.home .transcript .t-gutter > .t-check {
  flex: none;
  margin: 0;
}
.home .transcript .t-gutter > .t-cmd,
.home .transcript .t-gutter > .t-copy,
.home .transcript .t-gutter > .t-gutter-body {
  flex: 1 1 auto;
  min-width: 0;
}

/* Comment and output are plain text; hang their wraps under the first column. */
.home .transcript .t-comment,
.home .transcript .t-output {
  padding-left: 1.4em;
  text-indent: -1.4em;
}
.home .transcript .t-prompt { color: hsl(var(--subtle)); user-select: none; }
.home .transcript .t-cmd {
  color: hsl(var(--foreground));
  text-decoration: underline;
  text-decoration-color: hsl(var(--rule-strong));
  text-underline-offset: 3px;
  text-decoration-thickness: 1px;
}
.home .transcript .t-comment { color: hsl(var(--muted)); }
.home .transcript .t-success { color: hsl(var(--foreground)); }
.home .transcript .t-check { color: hsl(var(--accent)); font-weight: 500; }
.home .transcript .t-output { color: hsl(var(--subtle)); }
/* The result gesture echoes the brand mark: a caret pointing along a box-drawing
   wire (─, not an em-dash) into an accent node (●). A single tight glyph run, so
   it renders crisp and identical on every line. */
.home .transcript .t-gesture {
  color: hsl(var(--muted));
  letter-spacing: -0.04em;
}
.home .transcript .t-gesture-node { color: hsl(var(--accent)); }
.home .transcript .t-origin { color: hsl(var(--muted)); }
.home .transcript .t-id {
  color: hsl(var(--accent));
  font-weight: 500;
  overflow-wrap: anywhere;
  text-decoration: underline;
  text-decoration-color: hsl(var(--accent) / 0.35);
  text-underline-offset: 3px;
  text-decoration-thickness: 1px;
}

.home .transcript .t-copy {
  appearance: none;
  /*
   * Flow the copy button's text as part of the line (inline, not the button
   * default of inline-block + centered) so a long command or URL wraps left
   * aligned under the line's hanging indent instead of centering its own box.
   */
  display: inline;
  text-align: left;
  font: inherit;
  color: inherit;
  background: transparent;
  border: 0;
  cursor: copy;
  padding: 0;
  margin: 0;
  border-radius: 3px;
  transition: background 120ms var(--ease-out);
}

.home .transcript .t-copy:hover { background: hsl(var(--accent-tint)); }
.home .transcript .t-copy[data-copied="true"] { background: hsl(var(--accent) / 0.22); }

.t-cursor {
  display: inline-block;
  width: 8px;
  height: 1.05em;
  vertical-align: -0.18em;
  background: hsl(var(--accent));
  margin-left: 2px;
  animation: home-blink 1.1s steps(2) infinite;
}

@keyframes home-blink {
  50% { opacity: 0; }
}

/* The shell has room from 640px up; just restore the desktop size and rhythm. */
@media (min-width: 640px) {
  .home .transcript {
    padding: 20px 22px;
    font-size: 13px;
    line-height: 1.85;
  }
  .home .transcript .t-line { margin-block: 0.62em; }
}`;

const HOME_SECTION = `.home-section {
  padding-block: clamp(72px, 10vw, 128px);
}

.section-head {
  text-align: center;
  max-width: 60ch;
  margin: 0 auto clamp(44px, 6vw, 72px);
}

.section-kicker {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: hsl(var(--accent));
  margin-bottom: 18px;
}

.section-kicker::before,
.section-kicker::after {
  content: "";
  width: 18px;
  height: 1px;
  background: hsl(var(--accent) / 0.5);
}

.section-title {
  font-family: var(--font-ui);
  font-optical-sizing: auto;
  font-size: clamp(30px, 4.4vw, 46px);
  font-weight: 700;
  line-height: 1.04;
  letter-spacing: -0.03em;
  color: hsl(var(--foreground));
  text-wrap: balance;
}

.section-sub {
  margin-top: 18px;
  font-size: clamp(15px, 1.2vw, 18px);
  line-height: 1.6;
  color: hsl(var(--muted));
}`;

const HOME_USECASES = `.usecases {
  display: grid;
  gap: 18px;
  grid-template-columns: 1fr;
}

@media (min-width: 620px) {
  .usecases { grid-template-columns: repeat(2, 1fr); }
}

@media (min-width: 980px) {
  .usecases { grid-template-columns: repeat(4, 1fr); }
}

.usecase {
  position: relative;
  border: 1px solid hsl(var(--rule));
  border-radius: var(--radius-md);
  background: hsl(var(--surface));
  padding: 24px 22px 26px;
  display: grid;
  gap: 14px;
  align-content: start;
  transition: border-color 180ms var(--ease-out), background 180ms var(--ease-out);
}

.usecase:hover {
  border-color: hsl(var(--rule-strong));
  background: hsl(var(--surface-2));
}

.usecase-icon {
  display: inline-flex;
  width: 38px;
  height: 38px;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md);
  background: hsl(var(--accent-tint));
  color: hsl(var(--accent));
}

.usecase-icon svg { width: 19px; height: 19px; }

.usecase-who {
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: hsl(var(--subtle));
}

.usecase-title {
  font-size: 17px;
  font-weight: 600;
  line-height: 1.28;
  letter-spacing: -0.015em;
  color: hsl(var(--foreground));
}

.usecase-body {
  font-size: 13.5px;
  line-height: 1.55;
  color: hsl(var(--muted));
}`;

const HOME_PILLARS = `.home-pillars {
  display: grid;
  gap: 1px;
  background: hsl(var(--rule));
  border: 1px solid hsl(var(--rule));
  border-radius: var(--radius-md);
  overflow: hidden;
}

@media (min-width: 720px) {
  .home-pillars { grid-template-columns: 1fr 1fr; }
}

.home-pillar {
  background: hsl(var(--surface));
  padding: 30px 28px;
  display: grid;
  gap: 12px;
  transition: background 160ms var(--ease-out);
}

.home-pillar:hover { background: hsl(var(--surface-2)); }

.home-pillar-num {
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.1em;
  color: hsl(var(--accent));
}

.home-pillar-title {
  font-size: 21px;
  font-weight: 600;
  line-height: 1.25;
  letter-spacing: -0.018em;
  color: hsl(var(--foreground));
}

.home-pillar-body {
  font-size: 14.5px;
  line-height: 1.6;
  color: hsl(var(--muted));
}`;

const HOME_DIAGRAM = `.diagram {
  display: grid;
  gap: 18px;
  align-items: center;
  grid-template-columns: 1fr;
  max-width: 880px;
  margin: 0 auto;
}

@media (min-width: 860px) {
  .diagram { grid-template-columns: 1fr auto 1fr; }
}

.diagram-id {
  border: 1px solid hsl(var(--accent) / 0.5);
  background: hsl(var(--accent-tint));
  border-radius: var(--radius-md);
  padding: 22px 24px;
  text-align: center;
}

.diagram-id .label {
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: hsl(var(--accent));
}

.diagram-id .val {
  margin-top: 10px;
  font-family: var(--font-mono);
  font-size: 14px;
  color: hsl(var(--foreground));
  word-break: break-all;
}

.diagram-mid {
  display: grid;
  place-items: center;
}

.diagram-mid svg {
  width: 100%;
  max-width: 120px;
  height: 64px;
  color: hsl(var(--accent));
}

@media (max-width: 859px) {
  .diagram-mid svg { transform: rotate(90deg); max-width: 64px; }
}

.diagram-out {
  display: grid;
  gap: 14px;
}

.diagram-card {
  border: 1px solid hsl(var(--rule));
  background: hsl(var(--surface));
  border-radius: var(--radius-md);
  padding: 18px 20px;
  display: grid;
  gap: 6px;
  transition: border-color 160ms var(--ease-out), background 160ms var(--ease-out);
}

.diagram-card:hover { border-color: hsl(var(--rule-strong)); background: hsl(var(--surface-2)); }

.diagram-card .head {
  display: flex;
  align-items: center;
  gap: 9px;
  font-weight: 600;
  font-size: 15px;
}

.diagram-card .head svg { width: 16px; height: 16px; color: hsl(var(--accent)); }

.diagram-card .desc {
  font-size: 13px;
  color: hsl(var(--subtle));
  font-family: var(--font-mono);
}`;

const HOME_FEATURES = `.home-features {
  display: grid;
  gap: 1px;
  background: hsl(var(--rule));
  border: 1px solid hsl(var(--rule));
  border-radius: var(--radius-md);
  overflow: hidden;
}

@media (min-width: 760px) {
  .home-features { grid-template-columns: 1fr 1fr; }
}

.home-feature {
  background: hsl(var(--surface));
  padding: 32px 30px;
  display: grid;
  gap: 12px;
  align-content: start;
  position: relative;
  transition: background 160ms var(--ease-out);
}

.home-feature:hover { background: hsl(var(--surface-2)); }

.home-feature-mark {
  display: inline-flex;
  width: 34px;
  height: 34px;
  align-items: center;
  justify-content: center;
  border: 1px solid hsl(var(--rule-strong));
  border-radius: var(--radius-md);
  color: hsl(var(--accent));
}

.home-feature-mark svg { width: 17px; height: 17px; }

.home-feature-title {
  font-size: 19px;
  font-weight: 600;
  letter-spacing: -0.015em;
  line-height: 1.25;
}

.home-feature-body {
  font-size: 14.5px;
  line-height: 1.6;
  color: hsl(var(--muted));
}

.home-feature-body code {
  font-family: var(--font-mono);
  font-feature-settings: "zero";
  font-size: 0.9em;
  color: hsl(var(--foreground));
  background: hsl(var(--surface-3));
  padding: 1px 5px;
  border-radius: var(--radius-sm);
}`;

const HOME_CTA = `.home-cta {
  text-align: center;
  padding-block: clamp(80px, 11vw, 150px);
}

.cta-card {
  position: relative;
  max-width: 820px;
  margin: 0 auto;
  border: 1px solid hsl(var(--rule));
  border-radius: var(--radius-md);
  background: hsl(var(--surface));
  padding: clamp(40px, 6vw, 72px) 32px;
  overflow: hidden;
}

.cta-card > * { position: relative; }

.cta-title {
  font-size: clamp(30px, 4.6vw, 52px);
  font-weight: 700;
  line-height: 1.02;
  letter-spacing: -0.035em;
}

.cta-title .stop { color: hsl(var(--accent)); }

.cta-sub {
  margin: 20px auto 0;
  max-width: 50ch;
  font-size: clamp(15px, 1.2vw, 18px);
  line-height: 1.6;
  color: hsl(var(--muted));
}

.cta-sub code {
  font-family: var(--font-mono);
  color: hsl(var(--accent));
}

.cta-actions {
  display: inline-flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 12px;
  margin-top: 34px;
}

/*
 * Mobile-first: a left-aligned square box. The $ is a fixed gutter, the command
 * wraps in the remaining column, and "click to copy" sits on its own row. At
 * >=560px (below) it collapses to a single inline row once the command fits on
 * one line; the corners stay square (--radius-md) on both, matching web inputs.
 */
.cta-install {
  margin-top: 26px;
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: baseline;
  gap: 4px 10px;
  width: 100%;
  max-width: 420px;
  margin-inline: auto;
  text-align: left;
  font-family: var(--font-mono);
  font-size: 13px;
  color: hsl(var(--muted));
  border: 1px solid hsl(var(--rule));
  border-radius: var(--radius-md);
  padding: 14px 16px;
  background: hsl(var(--background) / 0.5);
  cursor: copy;
  transition: border-color 140ms var(--ease-out), background 140ms;
}

.cta-install-cmd { min-width: 0; overflow-wrap: anywhere; }

.cta-install .copyhint {
  grid-column: 2;
  margin-top: 2px;
}

@media (min-width: 560px) {
  .cta-install {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    width: auto;
    max-width: none;
    padding: 9px 16px;
  }
  .cta-install .copyhint { grid-column: auto; margin-top: 0; }
}

.cta-install:hover { border-color: hsl(var(--rule-strong)); background: hsl(var(--surface-2)); }
.cta-install[data-copied="true"] { border-color: hsl(var(--accent) / 0.5); background: hsl(var(--accent-tint)); }
.cta-install .prompt { color: hsl(var(--accent)); }
.cta-install .copyhint { color: hsl(var(--faint)); font-size: 11px; }`;

const HOME_FOOTER = `.home-foot {
  border-top: 1px solid hsl(var(--rule));
  padding-block: 56px 40px;
}

.home-foot-grid {
  display: grid;
  gap: 40px;
  grid-template-columns: 1fr;
}

@media (min-width: 640px) {
  .home-foot-grid {
    grid-template-columns: 1.4fr repeat(4, 1fr);
    gap: 48px 40px;
  }
}

.home-foot-brand {
  display: grid;
  gap: 14px;
  align-content: start;
  max-width: 32ch;
}

.home-foot-brand .brand-mark { width: 22px; height: 22px; }

.home-foot-tag {
  font-size: 13.5px;
  line-height: 1.55;
  color: hsl(var(--subtle));
}

.home-foot-heading {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: hsl(var(--subtle));
  margin-bottom: 14px;
}

.home-foot-list { display: grid; gap: 9px; }

.home-foot-link {
  font-size: 13.5px;
  color: hsl(var(--muted));
  transition: color 120ms var(--ease-out);
}

.home-foot-link:hover { color: hsl(var(--accent)); }

.home-foot-base {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-top: 48px;
  padding-top: 28px;
  border-top: 1px solid hsl(var(--rule));
}

.home-foot-tagline {
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: hsl(var(--faint));
}

.home-foot-copy {
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: hsl(var(--subtle));
  margin-left: auto;
}`;

const HOME_REVEAL = `.home .reveal {
  opacity: 0;
  transform: translateY(14px);
}

.home .reveal.in {
  opacity: 1;
  transform: none;
  transition: opacity 0.7s var(--ease-out), transform 0.7s var(--ease-out);
}

.home .d1 { transition-delay: 0.05s; }
.home .d2 { transition-delay: 0.13s; }
.home .d3 { transition-delay: 0.21s; }
.home .d4 { transition-delay: 0.29s; }
.home .d5 { transition-delay: 0.37s; }
.home .d6 { transition-delay: 0.45s; }

@media (prefers-reduced-motion: reduce) {
  .home .reveal { opacity: 1 !important; transform: none !important; }
  .t-cursor,
  .home-eyebrow .dot { animation: none !important; }
}`;

export const HOME_STYLES = [
  HOME_TOKENS,
  HOME_ATMOSPHERE,
  HOME_LAYOUT,
  HOME_PAGEBODY,
  HOME_TOPBAR,
  HOME_BUTTONS,
  HOME_HERO,
  HOME_TRANSCRIPT,
  HOME_SECTION,
  HOME_USECASES,
  HOME_PILLARS,
  HOME_DIAGRAM,
  HOME_FEATURES,
  HOME_CTA,
  HOME_FOOTER,
  HOME_REVEAL,
].join("\n\n");
