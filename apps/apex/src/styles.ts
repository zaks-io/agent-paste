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
  --neutral-150: 36 8% 93%;
  --neutral-200: 30 6% 88%;
  --neutral-300: 28 5% 78%;
  --neutral-400: 26 4% 60%;
  --neutral-500: 24 4% 44%;
  --neutral-600: 24 5% 32%;
  --neutral-700: 24 6% 20%;
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
  --rule-strong: var(--neutral-300);
  --primary: var(--neutral-900);
  --primary-fg: var(--neutral-50);
  --accent: var(--accent-1);
  --selection: 162 60% 24% / 0.16;

  --font-ui: "Hanken Grotesk Variable", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace;

  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
  --space-10: 40px;
  --space-12: 48px;
  --space-16: 64px;
  --space-20: 80px;
  --space-24: 96px;
  --space-32: 128px;

  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 10px;

  --container-prose: 62ch;
  --container-narrow: 640px;
  --container-default: 1040px;

  --ease-out: cubic-bezier(0.2, 0.8, 0.2, 1);
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
    --rule-strong: 24 8% 24%;
    --primary: var(--neutral-50);
    --primary-fg: var(--neutral-900);
    --accent: var(--accent-3);
    --selection: 158 50% 52% / 0.22;
  }
}

*,
*::before,
*::after {
  box-sizing: border-box;
}

html {
  -webkit-text-size-adjust: 100%;
  text-size-adjust: 100%;
}

body {
  margin: 0;
  background: hsl(var(--background));
  color: hsl(var(--foreground));
  font-family: var(--font-ui);
  font-size: 14.5px;
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
h2,
h3,
h4 {
  margin: 0;
  font-weight: 600;
  letter-spacing: -0.02em;
}

ul {
  margin: 0;
  padding: 0;
  list-style: none;
}

button {
  font: inherit;
  color: inherit;
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
}

:focus-visible {
  outline: 2px solid hsl(var(--accent));
  outline-offset: 2px;
  border-radius: 3px;
}

.bleed {
  width: 100%;
}

.container {
  max-width: var(--container-default);
  margin-inline: auto;
  padding-inline: var(--space-6);
}

@media (min-width: 640px) {
  .container {
    padding-inline: var(--space-8);
  }
}
@media (min-width: 1024px) {
  .container {
    padding-inline: var(--space-10);
  }
}

.prose {
  max-width: var(--container-prose);
  margin-inline: auto;
  padding-inline: var(--space-6);
}

@media (min-width: 640px) {
  .prose {
    padding-inline: var(--space-8);
  }
}

/* Masthead */

.masthead {
  height: 52px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid hsl(var(--rule));
}

.wordmark {
  font-weight: 700;
  letter-spacing: -0.02em;
  font-size: 15px;
  display: inline-flex;
  align-items: center;
  color: hsl(var(--foreground));
}

.wordmark-hyphen {
  color: hsl(var(--accent));
  padding-inline: 0.05em;
}

.masthead-nav {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.masthead-link {
  font-size: 13px;
  color: hsl(var(--muted));
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  transition: color 80ms var(--ease-out), background 80ms var(--ease-out);
}

.masthead-link:hover {
  color: hsl(var(--foreground));
  background: hsl(var(--surface-sunken));
}

@media (max-width: 559px) {
  .masthead-link.is-secondary {
    display: none;
  }
}

/* Buttons */

.button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  height: 34px;
  padding-inline: 14px;
  border-radius: var(--radius-md);
  font-weight: 500;
  font-size: 14px;
  letter-spacing: -0.005em;
  border: 1px solid transparent;
  transition: background 80ms var(--ease-out), color 80ms var(--ease-out), border-color 80ms var(--ease-out);
  white-space: nowrap;
}

.button-primary {
  background: hsl(var(--primary));
  color: hsl(var(--primary-fg));
}

.button-primary:hover {
  background: hsl(var(--neutral-800));
}

@media (prefers-color-scheme: dark) {
  .button-primary:hover {
    background: hsl(var(--neutral-150));
  }
}

.button-secondary {
  background: hsl(var(--surface));
  border-color: hsl(var(--rule-strong));
  color: hsl(var(--foreground));
}

.button-secondary:hover {
  background: hsl(var(--surface-sunken));
}

.button-link {
  background: transparent;
  color: hsl(var(--foreground));
  padding-inline: 8px;
  height: 34px;
}

.button-link:hover {
  color: hsl(var(--accent));
}

.button-lg {
  height: 40px;
  padding-inline: 18px;
  font-size: 15px;
}

/* Hero */

.hero {
  padding-block: var(--space-20) var(--space-12);
}

@media (min-width: 768px) {
  .hero {
    padding-block: var(--space-24) var(--space-16);
  }
}

.hero-content {
  max-width: 760px;
}

.hero-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 500;
  color: hsl(var(--muted));
  margin-bottom: var(--space-6);
}

.hero-eyebrow::before {
  content: "";
  display: inline-block;
  width: 14px;
  height: 1px;
  background: hsl(var(--accent));
}

.hero-headline {
  font-size: clamp(48px, 7vw + 8px, 72px);
  line-height: 1;
  letter-spacing: -0.025em;
  font-weight: 600;
  margin-bottom: var(--space-6);
  color: hsl(var(--foreground));
}

.hero-headline-emph {
  color: hsl(var(--accent));
}

.hero-lead {
  font-size: 17px;
  line-height: 1.55;
  letter-spacing: -0.005em;
  color: hsl(var(--muted));
  max-width: 60ch;
  margin-bottom: var(--space-8);
}

.hero-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
}

/* Install block */

.install {
  margin-top: var(--space-12);
  max-width: 720px;
}

.code-block {
  position: relative;
  margin: 0;
  background: hsl(var(--surface-sunken));
  border: 1px solid hsl(var(--rule));
  border-radius: var(--radius-sm);
  padding: var(--space-4) var(--space-5);
  padding-right: 56px;
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.55;
  color: hsl(var(--foreground));
  overflow-x: auto;
}

.code-block .prompt {
  color: hsl(var(--muted));
  user-select: none;
  margin-right: var(--space-2);
}

.code-copy {
  position: absolute;
  top: 6px;
  right: 6px;
  height: 28px;
  padding-inline: 10px;
  font-family: var(--font-ui);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: hsl(var(--muted));
  background: transparent;
  border: 1px solid transparent;
  border-radius: 3px;
  transition: color 80ms var(--ease-out), background 80ms var(--ease-out), border-color 80ms var(--ease-out);
}

.code-copy:hover {
  color: hsl(var(--foreground));
  background: hsl(var(--surface));
  border-color: hsl(var(--rule));
}

.code-copy[data-copied="true"] {
  color: hsl(var(--accent));
}

.install-meta {
  margin-top: var(--space-5);
  font-size: 13px;
  color: hsl(var(--muted));
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-3);
}

.id {
  font-family: var(--font-mono);
  font-weight: 500;
  font-size: 13px;
  line-height: 1.4;
  letter-spacing: -0.005em;
  color: hsl(var(--muted));
  cursor: copy;
  padding: 1px 5px;
  margin: -1px -5px;
  border-radius: 3px;
  transition: background 120ms var(--ease-out), color 120ms var(--ease-out);
}

.id:hover {
  background: hsl(var(--accent) / 0.08);
  color: hsl(var(--foreground));
}

.id[data-copied="true"] {
  color: hsl(var(--accent));
  background: hsl(var(--accent) / 0.12);
}

/* Features */

.features {
  border-top: 1px solid hsl(var(--rule));
  padding-block: var(--space-16) var(--space-20);
  background: hsl(var(--surface));
}

@media (min-width: 768px) {
  .features {
    padding-block: var(--space-20) var(--space-24);
  }
}

.features-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--space-12);
}

@media (min-width: 768px) {
  .features-grid {
    grid-template-columns: 1fr 1fr;
    gap: var(--space-12) var(--space-16);
  }
}

.feature {
  max-width: 56ch;
}

.feature-index {
  display: inline-block;
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 500;
  color: hsl(var(--accent));
  margin-bottom: var(--space-3);
  letter-spacing: 0;
}

.feature-h {
  font-size: 22px;
  line-height: 1.25;
  letter-spacing: -0.015em;
  font-weight: 600;
  color: hsl(var(--foreground));
  margin-bottom: var(--space-3);
}

.feature-body {
  font-size: 14.5px;
  line-height: 1.6;
  color: hsl(var(--muted));
}

/* Mental model block */

.mental-model {
  padding-block: var(--space-16);
  border-top: 1px solid hsl(var(--rule));
}

@media (min-width: 768px) {
  .mental-model {
    padding-block: var(--space-20);
  }
}

.mental-model-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--space-10);
  align-items: start;
}

@media (min-width: 900px) {
  .mental-model-grid {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr);
    gap: var(--space-16);
  }
}

.mental-model-heading {
  font-size: 28px;
  line-height: 1.1;
  letter-spacing: -0.02em;
  font-weight: 600;
  margin-bottom: var(--space-4);
}

.mental-model-body {
  font-size: 15.5px;
  line-height: 1.6;
  color: hsl(var(--muted));
  max-width: 52ch;
}

.terms {
  display: grid;
  grid-template-columns: max-content 1fr;
  column-gap: var(--space-6);
  row-gap: var(--space-3);
  margin: 0;
}

.terms dt {
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 500;
  color: hsl(var(--accent));
  padding-top: 2px;
  letter-spacing: 0;
}

.terms dd {
  margin: 0;
  font-size: 14px;
  line-height: 1.55;
  color: hsl(var(--foreground));
}

.terms dd .muted {
  color: hsl(var(--muted));
}

/* Footer */

.footer {
  border-top: 1px solid hsl(var(--rule));
  background: hsl(var(--background));
  padding-block: var(--space-12) var(--space-10);
}

.footer-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--space-8);
  margin-bottom: var(--space-10);
}

@media (min-width: 560px) {
  .footer-grid {
    grid-template-columns: 1fr 1fr;
  }
}

@media (min-width: 900px) {
  .footer-grid {
    grid-template-columns: repeat(4, 1fr);
    gap: var(--space-10);
  }
}

.footer-col h3 {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: hsl(var(--muted));
  margin-bottom: var(--space-4);
}

.footer-col li {
  margin-bottom: var(--space-2);
}

.footer-col a {
  font-size: 13.5px;
  color: hsl(var(--foreground));
  transition: color 80ms var(--ease-out);
}

.footer-col a:hover {
  color: hsl(var(--accent));
}

.footer-meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  align-items: baseline;
  justify-content: space-between;
  border-top: 1px solid hsl(var(--rule));
  padding-top: var(--space-6);
  font-family: var(--font-mono);
  font-size: 11px;
  color: hsl(var(--subtle));
  letter-spacing: 0;
}

.footer-meta a {
  color: hsl(var(--muted));
}

.footer-meta a:hover {
  color: hsl(var(--foreground));
}

/* Reduced motion */

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    transition-duration: 1ms !important;
    animation-duration: 1ms !important;
    animation-iteration-count: 1 !important;
  }
}
`;
