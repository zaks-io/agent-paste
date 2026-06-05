export const STYLES = `
@font-face {
  font-family: "Hanken Grotesk Variable";
  src: url("/fonts/HankenGrotesk-Variable.woff2") format("woff2-variations");
  font-weight: 100 900;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: "JetBrains Mono";
  src: url("/fonts/JetBrainsMono-Regular.woff2") format("woff2");
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: "JetBrains Mono";
  src: url("/fonts/JetBrainsMono-Medium.woff2") format("woff2");
  font-weight: 500;
  font-style: normal;
  font-display: swap;
}

:root {
  --neutral-50: 36 14% 98%;
  --neutral-100: 36 10% 96%;
  --neutral-200: 30 6% 88%;
  --neutral-300: 28 5% 78%;
  --neutral-400: 26 4% 60%;
  --neutral-500: 24 4% 44%;
  --neutral-800: 24 8% 12%;
  --neutral-900: 24 10% 7%;
  --neutral-950: 24 12% 4%;

  --accent-1: 162 60% 24%;
  --accent-3: 158 50% 52%;

  --background: var(--neutral-50);
  --surface: 36 16% 100%;
  --surface-sunken: var(--neutral-100);
  --foreground: var(--neutral-900);
  --muted: var(--neutral-500);
  --subtle: var(--neutral-400);
  --rule: var(--neutral-200);
  --primary: var(--neutral-900);
  --primary-fg: var(--neutral-50);
  --accent: var(--accent-1);
  --accent-fg: var(--neutral-50);
  --selection: 162 60% 24% / 0.16;

  --font-ui: "Hanken Grotesk Variable", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace;

  --radius-sm: 4px;
  --radius-md: 6px;

  --ease-out: cubic-bezier(0.2, 0.8, 0.2, 1);

  --container: 760px;
}

@media (prefers-color-scheme: dark) {
  :root {
    --background: var(--neutral-950);
    --surface: var(--neutral-900);
    --surface-sunken: 24 14% 2%;
    --foreground: var(--neutral-100);
    --muted: 24 5% 62%;
    --subtle: 24 4% 44%;
    --rule: 24 8% 16%;
    --primary: var(--neutral-50);
    --primary-fg: var(--neutral-900);
    --accent: var(--accent-3);
    --accent-fg: var(--neutral-950);
    --selection: 158 50% 52% / 0.22;
  }
}

*,
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
  line-height: 1.55;
  font-feature-settings: "ss01", "cv11";
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
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
  letter-spacing: 0;
}

.page {
  min-height: 100svh;
  max-width: var(--container);
  margin-inline: auto;
  padding: 24px 24px 32px;
  display: grid;
  grid-template-rows: auto 1fr auto;
  gap: 56px;
}

@media (min-width: 640px) {
  .page {
    padding: 32px 40px 40px;
    gap: 80px;
  }
}

/* ---- Header ---- */

.page-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
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

/* ---- Wordmark (style-guide §6.2: Hanken 700, hyphen in accent) ---- */

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
}

/* ---- Hero ---- */

.content {
  display: flex;
  flex-direction: column;
  gap: 80px;
}

.hero {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 22px;
}

.eyebrow {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: hsl(var(--subtle));
}

.hero-headline {
  font-size: clamp(44px, 8vw, 72px);
  line-height: 1;
  letter-spacing: -0.03em;
  color: hsl(var(--foreground));
  max-width: 14ch;
}

.hero-stop {
  color: hsl(var(--accent));
}

.hero-lead {
  font-size: clamp(16px, 1.4vw, 18px);
  line-height: 1.55;
  color: hsl(var(--muted));
  max-width: 56ch;
}

.hero-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 2px;
}

/* ---- Buttons ---- */

.button {
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
  border-color: hsl(var(--rule));
}

.button-ghost:hover {
  background: hsl(var(--surface-sunken));
  border-color: hsl(var(--rule));
}

/* ---- Transcript / code block (matches dashboard §5.6) ---- */

.transcript {
  margin: 6px 0 0;
  width: 100%;
  background: hsl(var(--surface-sunken));
  color: hsl(var(--foreground));
  border: 1px solid hsl(var(--rule));
  border-radius: var(--radius-sm);
  padding: 18px 20px;
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

.transcript .t-arrow {
  color: hsl(var(--subtle));
  user-select: none;
}

.transcript .t-origin {
  color: hsl(var(--muted));
}

.transcript .t-id {
  color: hsl(var(--accent));
}

/* Silently copyable strings (style-guide §5.11). */
.transcript .t-copy {
  cursor: copy;
  padding: 0 4px;
  margin: 0 -4px;
  border-radius: 3px;
  transition: background 120ms var(--ease-out);
}

.transcript .t-cmd.t-copy {
  text-decoration: underline;
  text-decoration-color: hsl(var(--rule));
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
  background: hsl(var(--accent) / 0.1);
}

.transcript .t-copy[data-copied="true"] {
  background: hsl(var(--accent) / 0.18);
}

/* ---- Features ---- */

.features {
  display: grid;
  gap: 40px;
  max-width: 62ch;
}

@media (min-width: 640px) {
  .features {
    gap: 56px;
  }
}

.feature-title {
  font-size: 22px;
  line-height: 1.25;
  letter-spacing: -0.015em;
  color: hsl(var(--foreground));
}

.feature-body {
  margin-top: 10px;
  font-size: 15px;
  line-height: 1.6;
  color: hsl(var(--muted));
}

.feature-body .code {
  font-family: var(--font-mono);
  font-size: 0.9em;
  letter-spacing: 0;
  color: hsl(var(--foreground));
}

/* ---- Prose (about page) ---- */

.prose {
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
  font-size: 19px;
  line-height: 1.3;
  letter-spacing: -0.012em;
  color: hsl(var(--foreground));
}

.prose-body {
  margin-top: 12px;
  font-size: 15px;
  line-height: 1.65;
  color: hsl(var(--muted));
}

.prose-body + .prose-body {
  margin-top: 14px;
}

.prose-body .code {
  font-family: var(--font-mono);
  font-size: 0.9em;
  letter-spacing: 0;
  color: hsl(var(--foreground));
}

/* ---- Legal pages ---- */

.legal-page {
  gap: 56px;
}

.legal-hero {
  display: grid;
  gap: 14px;
  max-width: 62ch;
}

.legal-title {
  font-size: 40px;
  line-height: 1.05;
  letter-spacing: 0;
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
  margin-top: 10px;
  font-size: 15px;
  line-height: 1.65;
  color: hsl(var(--muted));
}

.legal-body .code {
  font-family: var(--font-mono);
  font-size: 0.9em;
  letter-spacing: 0;
  color: hsl(var(--foreground));
}

.legal-list {
  display: grid;
  gap: 8px;
  padding-left: 1.1rem;
  list-style: disc;
}

.legal-list li::marker {
  color: hsl(var(--accent));
}

/* ---- Footer ---- */

.page-foot {
  display: flex;
  flex-direction: column;
  gap: 32px;
  padding-top: 28px;
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
  justify-content: space-between;
}

.foot-copy {
  font-size: 11.5px;
  color: hsl(var(--subtle));
  letter-spacing: 0.02em;
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    transition-duration: 1ms !important;
    animation-duration: 1ms !important;
  }
}
`;
