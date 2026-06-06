import { cssVarsBlock, fontFaceCss, grainCss } from "@agent-paste/brand";
import { HOME_STYLES } from "./home-styles.js";

// The apex stylesheet. Token layer (color/type/spacing), fonts, and the grain
// overlay come from @agent-paste/brand so apex shares one source with the web
// dashboard. Everything below the token layer is apex-specific component CSS.
//
// Discipline (style-guide.md): one flat violet accent, no gradient fills, no
// second accent, square-ish corners, type and whitespace over chrome.

const TOKENS = `${cssVarsBlock()}

:root {
  --container: 920px;
}`;

const FONT_FACES = fontFaceCss();

const GRAIN = grainCss();

const BASE = `*,
*::before,
*::after {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  background: hsl(var(--background));
  color: hsl(var(--foreground));
}

body {
  font-family: var(--font-ui);
  font-size: 15px;
  line-height: 1.5;
  letter-spacing: -0.006em;
  font-feature-settings: "ss01";
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}

/* Lift content above the fixed grain overlay (z-index: 0). */
body > * {
  position: relative;
  z-index: 1;
}

::selection {
  background: hsl(var(--selection));
}

a {
  color: inherit;
  text-decoration: none;
}

p {
  margin: 0;
}

h1,
h2 {
  margin: 0;
  font-weight: 600;
}

ul {
  margin: 0;
  padding: 0;
  list-style: none;
}

:focus-visible {
  outline: 2px solid hsl(var(--accent));
  outline-offset: 2px;
  border-radius: 3px;
}

.mono {
  font-family: var(--font-mono);
  font-feature-settings: "zero";
  letter-spacing: 0;
}

.font-display,
.hero-headline,
.legal-title,
.feature-title,
.prose-title,
.docs-section-title,
.docs-card-title,
.pillar-title {
  font-optical-sizing: auto;
}`;

const LAYOUT = `.page {
  min-height: 100svh;
  max-width: var(--container);
  margin-inline: auto;
  padding: 24px 24px 32px;
  display: grid;
  grid-template-rows: auto 1fr auto;
  gap: 64px;
}

@media (min-width: 640px) {
  .page {
    padding: 32px 40px 40px;
    gap: 80px;
  }
}

.content {
  display: flex;
  flex-direction: column;
  gap: 64px;
}

@media (min-width: 640px) {
  .content {
    gap: 72px;
  }
}`;

const HEADER = `.page-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.brand-mark {
  display: block;
}

.head-nav {
  display: flex;
  align-items: center;
  gap: 16px;
}

.head-link {
  font-family: var(--font-mono);
  font-size: 12.5px;
  color: hsl(var(--muted));
  transition: color 80ms var(--ease-out);
}

.head-link:hover {
  color: hsl(var(--accent));
}

/* Wordmark (style-guide §6.2: 700, hyphen in accent). */
.wordmark {
  font-weight: 700;
  font-size: 16px;
  letter-spacing: -0.02em;
  color: hsl(var(--foreground));
  display: inline-flex;
  align-items: baseline;
}

.wordmark-hyphen {
  color: hsl(var(--accent));
}

.wordmark-tld {
  color: hsl(var(--subtle));
  font-weight: 600;
}

.wordmark-sm {
  font-size: 14px;
}`;

// The gesture motif: chevron + line + node, the brand mark's grammar in pure CSS.
// Reused as the pillar marker, the transcript result lead, and section dividers.
const MOTIF = `.gesture {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.g-chevron {
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1;
  color: hsl(var(--accent));
}

.g-line {
  width: 16px;
  height: 1px;
  background: hsl(var(--accent) / 0.55);
}

.g-node {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: hsl(var(--accent));
}

.motif-rule {
  position: relative;
  height: 1px;
  border: 0;
  margin: 0;
  background: hsl(var(--rule));
}

.motif-rule::after {
  content: "";
  position: absolute;
  right: 0;
  top: 50%;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: hsl(var(--accent));
  transform: translateY(-50%);
}`;

const HERO = `.hero {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.hero-text {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 22px;
  width: 100%;
}

.eyebrow {
  font-family: var(--font-mono);
  font-size: 10.5px;
  font-weight: 500;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: hsl(var(--subtle));
  margin-bottom: -10px;
}

.eyebrow-link {
  display: inline-flex;
  align-items: center;
  gap: 0.5em;
  width: fit-content;
  text-decoration: none;
  transition: color 0.15s ease;
}

.eyebrow-link:hover,
.eyebrow-link:focus-visible {
  color: hsl(var(--foreground));
}

.eyebrow-link .eyebrow-back {
  transition: transform 0.15s ease;
}

.eyebrow-link:hover .eyebrow-back,
.eyebrow-link:focus-visible .eyebrow-back {
  transform: translateX(-2px);
}

.hero-headline {
  font-family: var(--font-ui);
  font-size: var(--text-hero);
  font-weight: 700;
  line-height: 0.96;
  letter-spacing: -0.035em;
  font-variation-settings: "opsz" 40;
  font-feature-settings: "ss01", "tnum";
  color: hsl(var(--foreground));
  max-width: 22ch;
  text-wrap: balance;
}

.hero-stop {
  color: hsl(var(--accent));
}

.hero-lead {
  font-size: clamp(16px, 1.2vw, 19px);
  line-height: 1.55;
  color: hsl(var(--muted));
  max-width: 54ch;
}

.hero-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 2px;
}

.transcript-figure {
  margin: 36px 0 0;
  width: 100%;
  max-width: 760px;
  min-width: 0;
}

@media (min-width: 760px) {
  .transcript-figure {
    margin-top: 44px;
  }
}`;

const BUTTONS = `.button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 36px;
  padding-inline: 16px;
  border-radius: var(--radius-md);
  font-weight: 500;
  font-size: 13.5px;
  letter-spacing: -0.005em;
  border: 1px solid transparent;
  transition: background 80ms var(--ease-out), border-color 80ms var(--ease-out), color 80ms var(--ease-out);
  white-space: nowrap;
  cursor: pointer;
}

.button::after {
  content: "";
  width: 0;
  height: 5px;
  margin-left: 0;
  border-radius: 50%;
  background: hsl(var(--accent));
  opacity: 0;
  transition: opacity 120ms var(--ease-out), width 120ms var(--ease-out), margin-left 120ms var(--ease-out);
}

.button:hover::after {
  width: 5px;
  margin-left: 8px;
  opacity: 1;
}

.button-sm {
  height: 30px;
  padding-inline: 12px;
  font-size: 13px;
}

.button-lg {
  height: 42px;
  padding-inline: 20px;
  font-size: 14.5px;
}

.button-primary {
  background: hsl(var(--primary));
  color: hsl(var(--primary-fg));
}

.button-primary:hover {
  background: hsl(var(--primary) / 0.9);
}

.button-ghost {
  background: transparent;
  color: hsl(var(--foreground));
  border-color: hsl(var(--rule-strong));
}

.button-ghost:hover {
  background: hsl(var(--surface-sunken));
  border-color: hsl(var(--rule-strong));
}`;

const TRANSCRIPT = `.transcript {
  margin: 0;
  width: 100%;
  background: hsl(var(--surface));
  color: hsl(var(--foreground));
  border: 1px solid hsl(var(--rule));
  border-radius: var(--radius-sm);
  padding: 16px 20px;
  font-size: 13px;
  line-height: 1.75;
  overflow-x: auto;
  white-space: pre;
  font-weight: 400;
}

.transcript .t-line {
  display: block;
}

.transcript .t-prompt {
  color: hsl(var(--subtle));
  user-select: none;
}

.transcript .t-cmd {
  color: hsl(var(--foreground));
}

.transcript .t-comment {
  color: hsl(var(--muted));
}

.transcript .t-success {
  color: hsl(var(--foreground));
}

.transcript .t-check {
  color: hsl(var(--accent));
  font-weight: 500;
}

.transcript .t-gesture {
  vertical-align: middle;
  margin-right: 6px;
}

.transcript .t-gesture .g-line {
  width: 12px;
}

.transcript .t-gesture .g-node {
  width: 4px;
  height: 4px;
}

.transcript .t-origin {
  color: hsl(var(--muted));
}

.transcript .t-id {
  color: hsl(var(--accent));
}

/* Silently copyable strings (style-guide §5.11). Real <button>, chrome stripped. */
.transcript .t-copy {
  appearance: none;
  font: inherit;
  color: inherit;
  background: transparent;
  border: 0;
  cursor: copy;
  padding: 0 4px;
  margin: 0 -4px;
  border-radius: 3px;
  transition: background 120ms var(--ease-out);
}

.transcript .t-cmd.t-copy {
  text-decoration: underline;
  text-decoration-color: hsl(var(--rule-strong));
  text-underline-offset: 3px;
  text-decoration-thickness: 1px;
}

.transcript .id {
  font-weight: 500;
  text-decoration: underline;
  text-decoration-color: hsl(var(--accent) / 0.35);
  text-underline-offset: 3px;
  text-decoration-thickness: 1px;
}

.transcript .t-copy:hover {
  background: hsl(var(--accent-tint));
}

.transcript .t-copy[data-copied="true"] {
  background: hsl(var(--accent) / 0.22);
}`;

const PILLARS = `.pillars-section {
  display: grid;
  gap: 24px;
}

.pillars-label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.pillars {
  display: grid;
  gap: 18px;
  max-width: 56ch;
}

.pillar {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: center;
  column-gap: 14px;
}

.pillar-title {
  font-family: var(--font-ui);
  font-size: 18px;
  font-weight: 600;
  line-height: 1.3;
  letter-spacing: -0.015em;
  color: hsl(var(--foreground));
}`;

const FEATURES = `.features {
  display: grid;
  gap: 40px;
  max-width: 62ch;
}

@media (min-width: 640px) {
  .features {
    gap: 48px;
  }
}

.feature-title {
  font-size: 22px;
  line-height: 1.25;
  letter-spacing: -0.015em;
  color: hsl(var(--foreground));
}

.feature-body {
  margin-top: 12px;
  font-size: 15px;
  line-height: 1.6;
  color: hsl(var(--muted));
}

.feature-body .code,
.prose-body .code,
.legal-body .code,
.docs-paragraph .code,
.docs-list .code,
.docs-table .code,
.docs-note .code {
  font-family: var(--font-mono);
  font-feature-settings: "zero";
  font-size: 0.9em;
  letter-spacing: 0;
  color: hsl(var(--foreground));
}`;

const PROSE = `.prose {
  display: grid;
  gap: 40px;
  max-width: 64ch;
}

@media (min-width: 640px) {
  .prose {
    gap: 48px;
  }
}

.prose-title {
  font-size: 22px;
  line-height: 1.25;
  letter-spacing: -0.015em;
  color: hsl(var(--foreground));
}

.prose-body {
  margin-top: 12px;
  font-size: 15px;
  line-height: 1.65;
  color: hsl(var(--muted));
}

.prose-body + .prose-body {
  margin-top: 12px;
}`;

const DOCS = `.docs-layout {
  gap: 56px;
}

.docs-hero {
  display: grid;
  gap: 16px;
  max-width: 68ch;
}

.docs-actions,
.docs-meta-links {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 14px;
  margin-top: 4px;
}

.docs-meta-links a,
.docs-inline-link,
.docs-link-list a {
  color: hsl(var(--foreground));
  text-decoration: underline;
  text-decoration-color: hsl(var(--accent) / 0.4);
  text-underline-offset: 3px;
  text-decoration-thickness: 1px;
}

.docs-meta-links a {
  font-family: var(--font-mono);
  font-size: 12.5px;
  color: hsl(var(--muted));
}

.docs-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
}

@media (min-width: 720px) {
  .docs-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.docs-card {
  display: grid;
  gap: 8px;
  min-height: 132px;
  padding: 18px;
  border: 1px solid hsl(var(--rule));
  border-radius: var(--radius-sm);
  background: hsl(var(--surface));
  transition: border-color 80ms var(--ease-out), background 80ms var(--ease-out);
}

.docs-card:hover {
  border-color: hsl(var(--rule-strong));
  background: hsl(var(--surface-sunken));
}

.docs-card-title {
  font-size: 18px;
  font-weight: 600;
  line-height: 1.25;
  letter-spacing: -0.012em;
}

.docs-card-body {
  font-size: 14px;
  line-height: 1.55;
  color: hsl(var(--muted));
}

.docs-body {
  display: grid;
  gap: 44px;
  max-width: 76ch;
}

.docs-section {
  scroll-margin-top: 24px;
}

.docs-section-title {
  font-size: 24px;
  line-height: 1.25;
  letter-spacing: -0.015em;
  color: hsl(var(--foreground));
}

.docs-paragraph,
.docs-list,
.docs-note,
.docs-link-list {
  margin-top: 12px;
  font-size: 15px;
  line-height: 1.65;
  color: hsl(var(--muted));
}

.docs-list,
.docs-link-list {
  padding-left: 1.1rem;
  list-style: disc;
}

.docs-ordered {
  list-style: decimal;
}

.docs-list li,
.docs-link-list li {
  margin-top: 6px;
}

.docs-list li::marker,
.docs-link-list li::marker {
  color: hsl(var(--accent));
}

.docs-link-list span {
  display: block;
  color: hsl(var(--muted));
}

.docs-code {
  margin: 14px 0 0;
  padding: 14px 16px;
  overflow-x: auto;
  border: 1px solid hsl(var(--rule));
  border-radius: var(--radius-sm);
  background: hsl(var(--surface));
  color: hsl(var(--foreground));
  font-size: 13px;
  line-height: 1.55;
  white-space: pre;
}

.docs-table-wrap {
  margin-top: 14px;
  overflow-x: auto;
  border: 1px solid hsl(var(--rule));
  border-radius: var(--radius-sm);
}

.docs-table {
  width: 100%;
  min-width: 560px;
  border-collapse: collapse;
  font-size: 13.5px;
  line-height: 1.45;
}

.docs-table th,
.docs-table td {
  padding: 11px 12px;
  text-align: left;
  vertical-align: top;
  border-bottom: 1px solid hsl(var(--rule));
}

.docs-table th {
  color: hsl(var(--foreground));
  background: hsl(var(--surface));
  font-weight: 600;
}

.docs-table td {
  color: hsl(var(--muted));
}

.docs-table tr:last-child td {
  border-bottom: 0;
}

.docs-note {
  display: grid;
  gap: 8px;
  padding: 14px 16px;
  border-left: 2px solid hsl(var(--accent));
  background: hsl(var(--accent-tint));
  border-radius: var(--radius-sm);
}

.docs-note-title {
  color: hsl(var(--foreground));
  font-weight: 600;
}`;

const PRICING = `.pricing-plans {
  display: grid;
  gap: 16px;
  margin-top: 48px;
}

@media (min-width: 640px) {
  .pricing-plans {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.pricing-plan-card {
  display: grid;
  gap: 12px;
  padding: 20px;
  border: 1px solid hsl(var(--rule));
  border-radius: var(--radius-md);
  background: hsl(var(--surface));
}

.pricing-plan-card-pro {
  border-color: hsl(var(--rule-strong));
}

.pricing-plan-name {
  font-size: 20px;
  color: hsl(var(--foreground));
}

.pricing-plan-price {
  display: flex;
  align-items: baseline;
  gap: 4px;
  margin: 0;
}

.pricing-plan-amount {
  font-size: 28px;
  color: hsl(var(--foreground));
}

.pricing-plan-per {
  font-size: 13px;
  color: hsl(var(--subtle));
}

.pricing-plan-note {
  font-size: 14px;
  line-height: 1.5;
  color: hsl(var(--muted));
}

.pricing-plan-cta {
  justify-self: start;
  margin-top: 4px;
}

.pricing-compare {
  display: grid;
  gap: 16px;
  margin-top: 56px;
}

.pricing-footnote {
  font-size: 14px;
  line-height: 1.55;
  color: hsl(var(--muted));
}

.pricing-footnote a {
  text-decoration: underline;
  text-underline-offset: 2px;
}`;

const LEGAL = `.legal-page {
  gap: 64px;
}

.legal-hero {
  display: grid;
  gap: 16px;
  max-width: 62ch;
}

.legal-title {
  font-size: 40px;
  line-height: 1.05;
  letter-spacing: -0.015em;
  color: hsl(var(--foreground));
}

@media (min-width: 640px) {
  .legal-title {
    font-size: 52px;
  }
}

.legal-updated {
  font-size: 12px;
  color: hsl(var(--subtle));
}

.legal-lead {
  font-size: 17px;
  line-height: 1.55;
  color: hsl(var(--muted));
}

.legal-sections {
  display: grid;
  gap: 40px;
  max-width: 68ch;
}

.legal-section {
  scroll-margin-top: 24px;
}

.legal-body {
  display: grid;
  gap: 12px;
  margin-top: 12px;
  font-size: 15px;
  line-height: 1.65;
  color: hsl(var(--muted));
}

.legal-list {
  display: grid;
  gap: 8px;
  padding-left: 1.1rem;
  list-style: disc;
}

.legal-list li::marker {
  color: hsl(var(--accent));
}`;

const FOOTER = `.page-foot {
  display: flex;
  flex-direction: column;
  gap: 32px;
  padding-top: 32px;
  border-top: 1px solid hsl(var(--rule));
}

.foot-cols {
  display: flex;
  flex-wrap: wrap;
  gap: 40px 64px;
}

.foot-heading {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: hsl(var(--subtle));
  margin-bottom: 12px;
}

.foot-list {
  display: grid;
  gap: 8px;
}

.foot-link {
  font-size: 13.5px;
  color: hsl(var(--muted));
  transition: color 80ms var(--ease-out);
}

.foot-link:hover {
  color: hsl(var(--accent));
}

.foot-base {
  display: flex;
  align-items: center;
  gap: 8px;
}

.foot-copy {
  font-size: 11.5px;
  color: hsl(var(--subtle));
  letter-spacing: 0.02em;
  margin-left: auto;
}`;

const MOTION = `@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    transition-duration: 1ms !important;
    animation-duration: 1ms !important;
  }
}`;

export const STYLES = [
  FONT_FACES,
  TOKENS,
  GRAIN,
  BASE,
  LAYOUT,
  HEADER,
  MOTIF,
  HERO,
  BUTTONS,
  TRANSCRIPT,
  PILLARS,
  FEATURES,
  PROSE,
  DOCS,
  PRICING,
  LEGAL,
  FOOTER,
  MOTION,
].join("\n\n");

// The marketing CSS, re-exported. Shell injects it on every apex page (all set
// `<body class="home">`); the home page renders full-bleed, while docs/legal/about
// reuse the shared chrome and constrain their content to `.page-body`.
export { HOME_STYLES };
