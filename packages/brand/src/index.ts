/**
 * Public surface of @agent-paste/brand: the design tokens plus small helpers that
 * emit CSS from them. The apex worker builds its inline <style> from these so its
 * color/type/spacing stays bound to the same source as the web dashboard.
 */

import {
  DARK,
  EASE_OUT,
  FONTS,
  LIGHT,
  RADII,
  SPACE,
  THEMES,
  type ThemeName,
  type ThemeTokens,
  TYPE,
} from "./tokens.js";

export * from "./privacy-preferences.js";
export * from "./theme-cookie.js";
export * from "./tokens.js";

export const OPERATING_COMPANY = {
  name: "Zaks.io, LLC",
  href: "https://zaks.io",
} as const;

/**
 * Map a theme's tokens onto the CSS custom-property names the apex stylesheet and
 * the web app both reference. Returns the `--name: value;` lines (no selector),
 * so the caller wraps them in `:root { ... }` or a media query.
 */
function themeVars(t: ThemeTokens): Record<string, string> {
  return {
    "--background": t.background,
    "--surface": t.surface,
    "--surface-2": t.surface2,
    "--surface-3": t.surface3,
    "--surface-sunken": t.surface2,
    "--rule": t.rule,
    "--rule-strong": t.ruleStrong,
    "--foreground": t.foreground,
    "--muted": t.muted,
    "--subtle": t.subtle,
    "--faint": t.faint,
    "--accent": t.accent,
    "--accent-dim": t.accentDim,
    "--accent-fg": t.accentFg,
    "--accent-tint": t.accentTint,
    "--selection": t.selection,
    "--success": t.success,
    "--warning": t.warning,
    "--destructive": t.destructive,
    // High-contrast neutral button pair: foreground-on-background, flipped.
    "--primary": t.foreground,
    "--primary-fg": t.background,
  };
}

/** Static (theme-independent) tokens: fonts, radii, easing, type scale, container. */
function staticVars(): Record<string, string> {
  return {
    "--font-ui": FONTS.body.stack,
    "--font-display": FONTS.display.stack,
    "--font-mono": FONTS.mono.stack,
    "--radius-xs": RADII.xs,
    "--radius-sm": RADII.sm,
    "--radius-md": RADII.md,
    "--ease-out": EASE_OUT,
    "--text-hero": TYPE.hero,
  };
}

function declarations(vars: Record<string, string>, indent = "  "): string {
  return Object.entries(vars)
    .map(([name, value]) => `${indent}${name}: ${value};`)
    .join("\n");
}

/**
 * The full token layer for an inline stylesheet: a light `:root` (static tokens +
 * light theme) and a dark `@media (prefers-color-scheme: dark)` override. This is
 * what apex embeds; the dark canvas matches the brand mark's frame.
 */
export function cssVarsBlock(): string {
  const root = { ...staticVars(), ...themeVars(THEMES.light) };
  return [
    ":root {",
    declarations(root),
    "}",
    "",
    "@media (prefers-color-scheme: dark) {",
    "  :root {",
    declarations(themeVars(THEMES.dark), "    "),
    "  }",
    "}",
  ].join("\n");
}

/**
 * Manual-override blocks: `[data-theme="light"]` and `[data-theme="dark"]` with
 * the full theme tokens. Emitted *after* `cssVarsBlock()` so a `data-theme`
 * attribute on the root wins over the `prefers-color-scheme` default at equal
 * specificity (later rule in source order). This is what lets a light/dark
 * toggle pin the theme regardless of the OS setting.
 */
export function themeOverrideCss(): string {
  return (Object.keys(THEMES) as ThemeName[])
    .map((name) => [`[data-theme="${name}"] {`, declarations(themeVars(THEMES[name])), "}"].join("\n"))
    .join("\n\n");
}

/** Just one theme's variables as `--name: value;` lines (for tests / web parity checks). */
export function themeVarLines(theme: ThemeName): Record<string, string> {
  return themeVars(THEMES[theme]);
}

/**
 * @font-face blocks for the self-hosted woff2. `basePath` is the URL prefix each
 * surface serves fonts from (default "/fonts"). All three faces are variable
 * (single weight axis), emitted with their supported weight range.
 */
export function fontFaceCss(basePath = "/fonts"): string {
  return Object.values(FONTS)
    .map(({ family, file, weightRange }) =>
      [
        "@font-face {",
        `  font-family: "${family}";`,
        `  src: url("${basePath}/${file}") format("woff2");`,
        `  font-weight: ${weightRange};`,
        "  font-style: normal;",
        "  font-display: swap;",
        "}",
      ].join("\n"),
    )
    .join("\n");
}

/** Editorial column widths. Not theme tokens; layout constants shared by both surfaces. */
const CONTAINER = { default: "1180px", wide: "1360px" } as const;

/**
 * The complete Tailwind v4 stylesheet, generated from the tokens above. This is
 * the single source the design system ships: `@agent-paste/ui` writes it to a
 * `.css` file that BOTH the web dashboard and the apex marketing site import, so
 * neither hand-authors tokens and the two cannot drift. Regenerate with
 * `pnpm --filter @agent-paste/ui test -u` after changing tokens.
 */
export function globalsCss(): string {
  const D = DARK;
  const L = LIGHT;
  return `@import "tailwindcss";

/* Self-hosted variable faces (served from public/fonts). Generated from FONTS. */
${fontFaceCss()}

/*
 * agent-paste design system — GENERATED from @agent-paste/brand tokens.
 * Do not edit by hand: change packages/brand/src/tokens.ts and regenerate
 * (pnpm --filter @agent-paste/ui test -u). Both apps/web and apps/apex import
 * this file, so they cannot drift.
 *
 * Discipline (enforced, not decorated):
 *   - Surface LADDER + 1px hairlines for depth. No cards. No drop shadows.
 *   - ONE accent (vermilion) with one job: primary action, focus, live-state.
 *   - Mono data rail with tabular figures. Square corners. No pills.
 */

:root {
  /* Neutral near-black ladder. Depth = lightness steps of a near-neutral hue. */
  --ink-0: ${D.background}; /* canvas */
  --ink-1: ${D.surface}; /* raised surface */
  --ink-2: ${D.surface2}; /* hover / inset */
  --ink-3: ${D.surface3}; /* strong inset */
  --line: ${D.rule}; /* hairline */
  --line-2: ${D.ruleStrong}; /* hairline strong */

  /* Faintly warm off-white ink ramp. */
  --fg-0: ${D.foreground};
  --fg-1: ${D.muted};
  --fg-2: ${D.subtle};
  --fg-3: ${D.faint};

  /* The one voltage. Vermilion. */
  --vermilion: ${D.accent};
  --vermilion-dim: ${D.accentDim};

  /* Semantic only — never decorative. */
  --live: ${D.success};
  --warn: ${D.warning};
  --gone: ${D.destructive};

  --space-px: ${SPACE[0.25]};
  --space-1: ${SPACE[1]};
  --space-2: ${SPACE[2]};
  --space-3: ${SPACE[3]};
  --space-4: ${SPACE[4]};
  --space-5: ${SPACE[5]};
  --space-6: ${SPACE[6]};
  --space-8: ${SPACE[8]};
  --space-10: ${SPACE[10]};
  --space-12: ${SPACE[12]};
  --space-16: ${SPACE[16]};
  --space-20: ${SPACE[20]};
  --space-24: ${SPACE[24]};
  --space-32: ${SPACE[32]};

  --container-default: ${CONTAINER.default};
  --container-wide: ${CONTAINER.wide};

  /* Square-ish. Radius is the exception, never the rule. */
  --radius-xs: ${RADII.xs};
  --radius-sm: ${RADII.sm};
  --radius-md: ${RADII.md};

  --ease-out: ${EASE_OUT};

  --text-hero: ${TYPE.hero};
  --text-h1: ${TYPE.h1};
  --text-h2: ${TYPE.h2};
  --text-h3: ${TYPE.h3};
  --text-body: ${TYPE.body};
  --text-sm: ${TYPE.sm};
  --text-xs: ${TYPE.xs};
  --text-meta: ${TYPE.meta};
  --text-mono: ${TYPE.mono};
  --text-mono-sm: ${TYPE.monoSm};
}

/* Dark is the product. Bare :root is dark so SSR first-paint is correct. */
:root,
[data-theme="dark"] {
  --background: var(--ink-0);
  --surface: var(--ink-1);
  --surface-2: var(--ink-2);
  --surface-3: var(--ink-3);
  --rule: var(--line);
  --rule-strong: var(--line-2);
  --foreground: var(--fg-0);
  --muted: var(--fg-1);
  --subtle: var(--fg-2);
  --faint: var(--fg-3);

  --accent: var(--vermilion);
  --accent-dim: var(--vermilion-dim);
  --accent-fg: ${D.accentFg};
  --accent-tint: ${D.accentTint};
  --selection: ${D.selection};
  --primary: var(--foreground);
  --primary-fg: var(--background);

  --success: var(--live);
  --warning: var(--warn);
  --destructive: var(--gone);
  --info: var(--fg-2);

  /* Compat aliases for surfaces referenced by chrome/command-palette/forms. */
  --surface-sunken: var(--ink-0);
  --surface-raised: var(--surface-2);
  --neutral-900: var(--ink-0);
  --neutral-50: var(--fg-0);
}

/* Light — warm paper, vermilion stays the voltage. First-class, co-equal with dark. */
[data-theme="light"] {
  --background: ${L.background};
  --surface: ${L.surface};
  --surface-2: ${L.surface2};
  --surface-3: ${L.surface3};
  --rule: ${L.rule};
  --rule-strong: ${L.ruleStrong};
  --foreground: ${L.foreground};
  --muted: ${L.muted};
  --subtle: ${L.subtle};
  --faint: ${L.faint};

  --accent: ${L.accent};
  --accent-dim: ${L.accentDim};
  --accent-fg: ${L.accentFg};
  --accent-tint: ${L.accentTint};
  --selection: ${L.selection};
  --primary: var(--foreground);
  --primary-fg: var(--background);

  --success: ${L.success};
  --warning: ${L.warning};
  --destructive: ${L.destructive};
  --info: ${L.muted};

  --surface-sunken: var(--surface-2);
  --surface-raised: var(--surface-2);
  --neutral-900: ${L.foreground};
  --neutral-50: ${L.background};
}

@theme {
  --font-display: ${FONTS.display.stack};
  --font-ui: ${FONTS.body.stack};
  --font-mono: ${FONTS.mono.stack};

  --color-background: hsl(var(--background));
  --color-surface: hsl(var(--surface));
  --color-surface-2: hsl(var(--surface-2));
  --color-surface-3: hsl(var(--surface-3));
  --color-surface-sunken: hsl(var(--surface-sunken));
  --color-surface-raised: hsl(var(--surface-raised));
  --color-rule: hsl(var(--rule));
  --color-rule-strong: hsl(var(--rule-strong));
  --color-foreground: hsl(var(--foreground));
  --color-muted: hsl(var(--muted));
  --color-subtle: hsl(var(--subtle));
  --color-faint: hsl(var(--faint));
  --color-accent: hsl(var(--accent));
  --color-accent-dim: hsl(var(--accent-dim));
  --color-accent-foreground: hsl(var(--accent-fg));
  --color-primary: hsl(var(--primary));
  --color-primary-foreground: hsl(var(--primary-fg));
  /* Pre-composed translucent accent. Alpha is baked into the channel string, so
   * use bg-accent-tint BARE — never with an /opacity modifier (would double-apply). */
  --color-accent-tint: hsl(var(--accent-tint));
  --color-success: hsl(var(--success));
  --color-warning: hsl(var(--warning));
  --color-destructive: hsl(var(--destructive));
  --color-info: hsl(var(--info));
  /* Scrim/overlay neutral. Theme-flipped (near-black dark / ink light); used as
   * bg-neutral-900/<alpha> for modal backdrops. */
  --color-neutral-900: hsl(var(--neutral-900));

  --radius: ${RADII.md};
  --radius-xs: ${RADII.xs};
  --radius-sm: ${RADII.sm};
  --radius-md: ${RADII.md};

  /* Type scale — mints text-meta … text-hero. Generated from TYPE; the named
   * step is the ONLY way to set a font size (no text-[..px] brackets). Each size
   * pairs a sensible default line-height so a bare \`text-h2\` reads correctly. */
  --text-meta: ${TYPE.meta};
  --text-meta--line-height: 1.4;
  --text-mono-sm: ${TYPE.monoSm};
  --text-mono-sm--line-height: 1.45;
  --text-xs: ${TYPE.xs};
  --text-xs--line-height: 1.5;
  --text-mono: ${TYPE.mono};
  --text-mono--line-height: 1.5;
  --text-sm: ${TYPE.sm};
  --text-sm--line-height: 1.55;
  --text-base: ${TYPE.body};
  --text-base--line-height: 1.6;
  --text-h3: ${TYPE.h3};
  --text-h3--line-height: 1.4;
  --text-lg: 16px;
  --text-lg--line-height: 1.5;
  --text-h2: ${TYPE.h2};
  --text-h2--line-height: 1.25;
  --text-h1: ${TYPE.h1};
  --text-h1--line-height: 1.1;
  --text-hero: ${TYPE.hero};
  --text-hero--line-height: 0.95;
  /* Fluid display steps — cover every clamp() headline the mockup uses, so the
   * panes/blocks set size with text-display-* instead of a bespoke clamp bracket. */
  --text-display-sm: clamp(24px, 2.6vw, 34px);
  --text-display-sm--line-height: 1.18;
  --text-display-md: clamp(40px, 5vw, 66px);
  --text-display-md--line-height: 1.02;
  --text-display-lg: clamp(42px, 7vw, 72px);
  --text-display-lg--line-height: 1.02;

  /* Line-height — mints leading-flush … leading-loose. */
  --leading-flush: 0.8;
  --leading-tight: 1.04;
  --leading-snug: 1.2;
  --leading-normal: 1.5;
  --leading-relaxed: 1.6;
  --leading-loose: 1.65;

  /* Tracking — mints tracking-tightest … tracking-eyebrow. */
  --tracking-tightest: -0.035em;
  --tracking-tighter: -0.02em;
  --tracking-tight: -0.01em;
  --tracking-normal: 0;
  --tracking-wide: 0.02em;
  --tracking-wider: 0.08em;
  --tracking-eyebrow: 0.16em;

  /* Motion — mints the ease-out utility. Kills every ease-[var(--ease-out)]. */
  --ease-out: ${EASE_OUT};
}

*,
*::before,
*::after {
  box-sizing: border-box;
}

html {
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
}

body {
  margin: 0;
  font-family: var(--font-ui);
  font-size: var(--text-body);
  line-height: 1.5;
  letter-spacing: -0.006em;
  color: hsl(var(--foreground));
  background-color: hsl(var(--background));
  font-feature-settings: "ss01";
}

::selection {
  background: hsl(var(--selection));
}

a {
  color: inherit;
  text-decoration: none;
}

button {
  font-family: inherit;
}

code,
kbd,
samp,
pre {
  font-family: var(--font-mono);
  font-feature-settings: "zero";
}

:focus-visible {
  outline: 2px solid hsl(var(--accent));
  outline-offset: 2px;
}

/* Scrollbars: in-theme, square, visible without shouting. Thumb is the subtle
 * ink, track is the canvas, so it reads as part of the surface ladder in both
 * modes. Firefox gets the thin two-color form; WebKit/Blink the box-model. */
* {
  scrollbar-width: thin;
  scrollbar-color: hsl(var(--subtle)) transparent;
}

::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background-color: hsl(var(--subtle));
  border: 2px solid transparent;
  background-clip: padding-box;
  border-radius: var(--radius-md);
}

::-webkit-scrollbar-thumb:hover {
  background-color: hsl(var(--muted));
}

::-webkit-scrollbar-corner {
  background: transparent;
}

/* Cabinet Grotesk as display: lean on weight. Tight tracking at large sizes. */
.font-display {
  font-family: var(--font-display);
}

/* The hero figure: bold anchor, sits inline on the baseline with its caption. */
.hero-figure {
  display: inline-block;
  font-family: var(--font-display);
  font-size: var(--text-hero);
  font-weight: 700;
  line-height: 0.8;
  letter-spacing: -0.04em;
  font-feature-settings: "ss01", "tnum";
}

/* Eyebrow / rail labels: uppercase mono, positive tracking — the instrument voice. */
.eyebrow {
  font-family: var(--font-mono);
  font-size: var(--text-meta);
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.16em;
  color: hsl(var(--subtle));
}

.tnum {
  font-feature-settings: "tnum";
  font-variant-numeric: tabular-nums;
}

/* Inline code chip. One treatment everywhere the shared Prose renders \`code\`,
 * so both surfaces match. */
.code {
  font-family: var(--font-mono);
  font-feature-settings: "zero";
  font-size: 0.9em;
  letter-spacing: 0;
  color: hsl(var(--foreground));
  background: hsl(var(--surface-3));
  padding: 1px 5px;
  border-radius: var(--radius-sm);
}

@keyframes skeleton-pulse {
  50% {
    opacity: 0.5;
  }
}

@keyframes fade-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes rise-in {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes modal-in {
  from {
    opacity: 0;
    transform: scale(0.98) translateY(4px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

@keyframes live-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.4;
  }
}

.rise {
  animation: rise-in 0.55s var(--ease-out) both;
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    /* biome-ignore-start lint/complexity/noImportantStyles: a11y override must defeat author styles */
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    /* biome-ignore-end lint/complexity/noImportantStyles: a11y override must defeat author styles */
  }
}
`;
}
