/**
 * Public surface of @agent-paste/brand: the design tokens plus small helpers that
 * emit CSS from them. The apex worker builds its inline <style> from these so its
 * color/type/spacing stays bound to the same source as the web dashboard.
 */

import { EASE_OUT, FONTS, RADII, THEMES, type ThemeName, type ThemeTokens, TYPE } from "./tokens.js";

export * from "./tokens.js";

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
    "--font-ui": FONTS.display.stack,
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

/** Just one theme's variables as `--name: value;` lines (for tests / web parity checks). */
export function themeVarLines(theme: ThemeName): Record<string, string> {
  return themeVars(THEMES[theme]);
}

/**
 * @font-face blocks for apex's self-hosted woff2. `basePath` is the URL prefix the
 * worker serves fonts from (default "/fonts"). Bricolage is emitted as a variable
 * font (woff2-variations) so its optical-size axis works.
 */
export function fontFaceCss(basePath = "/fonts"): string {
  const { display, mono } = FONTS;
  return [
    "@font-face {",
    `  font-family: "${display.family}";`,
    `  src: url("${basePath}/${display.apexFile}") format("woff2-variations");`,
    `  font-weight: ${display.weightRange};`,
    "  font-style: normal;",
    "  font-display: swap;",
    "}",
    "@font-face {",
    `  font-family: "${mono.family}";`,
    `  src: url("${basePath}/${mono.apexFiles[400]}") format("woff2");`,
    "  font-weight: 400;",
    "  font-style: normal;",
    "  font-display: swap;",
    "}",
    "@font-face {",
    `  font-family: "${mono.family}";`,
    `  src: url("${basePath}/${mono.apexFiles[500]}") format("woff2");`,
    "  font-weight: 500;",
    "  font-style: normal;",
    "  font-display: swap;",
    "}",
  ].join("\n");
}

/**
 * The grain overlay (the web app's signature atmosphere): a fixed, low-opacity
 * fractal-noise SVG behind content. The data: URI is CSP-safe under `img-src 'self'
 * data:`. Caller must also lift content above it (e.g. `body > * { z-index: 1 }`).
 */
export function grainCss(): string {
  const svg =
    "data:image/svg+xml,%3Csvg viewBox='0 0 240 240' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E";
  return [
    "body::before {",
    '  content: "";',
    "  position: fixed;",
    "  inset: 0;",
    "  z-index: 0;",
    "  pointer-events: none;",
    "  opacity: 0.035;",
    `  background-image: url("${svg}");`,
    "  background-size: 200px 200px;",
    "}",
    "@media (prefers-color-scheme: light) {",
    "  body::before { opacity: 0.025; mix-blend-mode: multiply; }",
    "}",
  ].join("\n");
}
