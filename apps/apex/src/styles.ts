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
  --foreground: var(--neutral-900);
  --muted: var(--neutral-500);
  --subtle: var(--neutral-400);
  --rule: var(--neutral-200);
  --primary: var(--neutral-900);
  --primary-fg: var(--neutral-50);
  --accent: var(--accent-1);
  --selection: 162 60% 24% / 0.16;

  --terminal-bg: var(--neutral-950);
  --terminal-fg: var(--neutral-100);
  --terminal-accent: var(--accent-3);

  --font-ui: "Hanken Grotesk Variable", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace;

  --ease-out: cubic-bezier(0.2, 0.8, 0.2, 1);
}

@media (prefers-color-scheme: dark) {
  :root {
    --background: var(--neutral-950);
    --foreground: var(--neutral-100);
    --muted: 24 5% 62%;
    --subtle: 24 4% 44%;
    --rule: 24 8% 16%;
    --primary: var(--neutral-50);
    --primary-fg: var(--neutral-900);
    --accent: var(--accent-3);
    --selection: 158 50% 52% / 0.22;
    --terminal-bg: 158 25% 6%;
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

h1 {
  margin: 0;
  font-weight: 600;
  letter-spacing: -0.035em;
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
  max-width: 720px;
  margin-inline: auto;
  padding: 28px 24px 24px;
  display: grid;
  grid-template-rows: auto 1fr auto;
  gap: 32px;
}

@media (min-width: 640px) {
  .page {
    padding: 40px 40px 32px;
    gap: 40px;
  }
}

.page-head {
  display: flex;
  align-items: center;
}

.wordmark {
  font-family: var(--font-mono);
  font-weight: 500;
  font-size: 14px;
  letter-spacing: -0.01em;
  display: inline-flex;
  align-items: baseline;
}

.wordmark-base {
  color: hsl(var(--foreground));
}

.wordmark-tld {
  color: hsl(var(--accent));
  font-weight: 600;
}

.hero {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 24px;
}

@media (min-width: 640px) {
  .hero {
    gap: 28px;
  }
}

.hero-headline {
  font-size: clamp(44px, 8vw, 80px);
  line-height: 0.98;
  color: hsl(var(--foreground));
  max-width: 14ch;
}

.hero-headline-stop {
  color: hsl(var(--accent));
}

.hero-lead {
  font-size: clamp(15px, 1.3vw, 17px);
  line-height: 1.5;
  color: hsl(var(--muted));
  max-width: 52ch;
}

.transcript {
  margin: 0;
  width: 100%;
  background: hsl(var(--terminal-bg));
  color: hsl(var(--terminal-fg));
  border-radius: 6px;
  padding: 16px 18px;
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.65;
  overflow-x: auto;
  white-space: pre;
  font-weight: 400;
}

.transcript .t-line {
  display: block;
}

.transcript .t-prompt {
  color: hsl(var(--terminal-accent));
  font-weight: 500;
  user-select: none;
}

.transcript .t-cmd {
  color: hsl(var(--terminal-fg));
}

.transcript .t-result .id {
  color: hsl(var(--terminal-accent));
  font-weight: 500;
  cursor: copy;
  padding: 0 4px;
  margin: 0 -4px;
  border-radius: 3px;
  transition: background 120ms var(--ease-out), color 120ms var(--ease-out);
  text-decoration: underline;
  text-decoration-color: hsl(var(--terminal-accent) / 0.35);
  text-underline-offset: 3px;
  text-decoration-thickness: 1px;
}

.transcript .t-origin {
  color: hsl(24 6% 56%);
  font-weight: 400;
}

.transcript .t-id {
  color: hsl(var(--terminal-accent));
}

.transcript .t-result .id:hover {
  background: hsl(var(--terminal-accent) / 0.14);
}

.transcript .t-result .id[data-copied="true"] {
  background: hsl(var(--terminal-accent) / 0.24);
  color: hsl(var(--terminal-fg));
}

.button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 36px;
  padding-inline: 16px;
  border-radius: 4px;
  font-weight: 500;
  font-size: 13.5px;
  letter-spacing: -0.005em;
  border: 1px solid transparent;
  transition: background 80ms var(--ease-out);
  white-space: nowrap;
}

.button-lg {
  height: 40px;
  padding-inline: 18px;
  font-size: 14px;
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
    background: hsl(var(--neutral-100));
  }
}

.page-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11.5px;
  color: hsl(var(--subtle));
  letter-spacing: 0.02em;
}

.foot-link {
  color: hsl(var(--subtle));
  transition: color 80ms var(--ease-out);
}

.foot-link:hover {
  color: hsl(var(--accent));
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
