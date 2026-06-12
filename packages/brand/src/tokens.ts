/**
 * agent-paste design tokens: the single source of truth for brand color, type,
 * and spacing across every surface (the web dashboard and the apex marketing
 * worker). Values are HSL triples without the `hsl()` wrapper, so a consumer can
 * compose them as `hsl(<triple>)` or `hsl(<triple> / <alpha>)`.
 *
 * Ported verbatim from the shipped web app (apps/web/src/styles/globals.css).
 * That file is the historical origin; this object is now the spec, and the web
 * CSS is checked against it so the two cannot drift.
 *
 * Discipline (do not break it):
 *   - One accent: vermilion, one job (primary action, focus, live-state).
 *   - Neutral near-black ladder (dark) and warm paper ladder (light), both
 *     first-class; depth via lightness steps of a near-neutral hue.
 *   - Warm-cool tension: a near-neutral canvas under a faintly warm ink.
 *   - Square-ish: radius is the exception, never the rule.
 */

/** An HSL triple, e.g. "248 73% 64%" (no hsl() wrapper, no alpha). */
export type HslTriple = string;

/** Per-theme surface, text, accent, and semantic values. */
export type ThemeTokens = {
  /** Page canvas. */
  background: HslTriple;
  /** Raised surface (panels, the transcript). */
  surface: HslTriple;
  /** Hover / inset surface. */
  surface2: HslTriple;
  /** Strong inset surface. */
  surface3: HslTriple;
  /** Hairline rule. */
  rule: HslTriple;
  /** Strong hairline rule. */
  ruleStrong: HslTriple;
  /** Primary text. */
  foreground: HslTriple;
  /** Secondary text. */
  muted: HslTriple;
  /** Tertiary text. */
  subtle: HslTriple;
  /** Faint text. */
  faint: HslTriple;
  /** The one accent: vermilion. */
  accent: HslTriple;
  /** Dimmed accent for hover. */
  accentDim: HslTriple;
  /** Text/icon color on an accent fill. */
  accentFg: HslTriple;
  /** Accent at low alpha for tint backgrounds (triple + " / <alpha>"). */
  accentTint: string;
  /** Text-selection highlight (triple + " / <alpha>"). */
  selection: string;
  /** Published / live state (semantic, never decorative). */
  success: HslTriple;
  /** Warning state (semantic). */
  warning: HslTriple;
  /** Destructive / gone state (semantic). */
  destructive: HslTriple;
};

export type ThemeName = "dark" | "light";

/** Neutral near-black ladder, vermilion accent. Matches globals.css `:root, [data-theme="dark"]`. */
export const DARK: ThemeTokens = {
  background: "240 6% 5%",
  surface: "240 7% 8%",
  surface2: "240 7% 11%",
  surface3: "240 8% 14%",
  rule: "240 8% 15%",
  ruleStrong: "240 7% 24%",
  foreground: "60 9% 95%",
  muted: "240 5% 80%",
  subtle: "240 5% 55%",
  faint: "240 5% 38%",
  accent: "10 100% 54%",
  accentDim: "10 78% 45%",
  accentFg: "0 0% 100%",
  accentTint: "10 100% 54% / 0.14",
  selection: "10 100% 54% / 0.3",
  success: "152 56% 52%",
  warning: "36 84% 58%",
  destructive: "4 72% 60%",
};

/** Warm paper ladder, vermilion stays the voltage. Matches `[data-theme="light"]`. */
export const LIGHT: ThemeTokens = {
  background: "60 17% 98%",
  surface: "0 0% 100%",
  surface2: "48 18% 94%",
  surface3: "45 16% 90%",
  rule: "45 16% 88%",
  ruleStrong: "44 13% 80%",
  foreground: "0 0% 4%",
  muted: "60 4% 22%",
  subtle: "0 0% 42%",
  faint: "50 3% 60%",
  accent: "10 100% 54%",
  accentDim: "10 82% 47%",
  accentFg: "0 0% 100%",
  accentTint: "10 100% 54% / 0.1",
  selection: "10 100% 54% / 0.16",
  success: "152 52% 36%",
  warning: "32 80% 42%",
  destructive: "4 66% 48%",
};

export const THEMES: Record<ThemeName, ThemeTokens> = { dark: DARK, light: LIGHT };

/** Square-ish radii. Radius is the exception, never the rule. */
export const RADII = {
  xs: "2px",
  sm: "3px",
  md: "4px",
} as const;

/** The one motion curve. */
export const EASE_OUT = "cubic-bezier(0.16, 0.84, 0.3, 1)";

/** 4px-based spacing scale, keyed by the multiple of 4 (so `4` => 16px). */
export const SPACE: Record<number, string> = {
  0.25: "1px",
  1: "4px",
  2: "8px",
  3: "12px",
  4: "16px",
  5: "20px",
  6: "24px",
  8: "32px",
  10: "40px",
  12: "48px",
  16: "64px",
  20: "80px",
  24: "96px",
  32: "128px",
};

/** Type scale. Hero is fluid; the rest are fixed steps. */
export const TYPE = {
  hero: "clamp(60px, 7vw, 84px)",
  h1: "30px",
  h2: "20px",
  h3: "15px",
  body: "14px",
  sm: "13px",
  xs: "12px",
  meta: "10.5px",
  mono: "12.5px",
  monoSm: "11.5px",
} as const;

/**
 * Brand fonts: three self-hosted variable faces. `family` is the @font-face name
 * both surfaces declare; `file` is the woff2 each app serves from its own
 * public/fonts dir (web via @font-face in globals.css, apex via the inline
 * fontFaceCss() below). All three carry a single weight axis, so one file covers
 * every weight we use.
 *   - display: Cabinet Grotesk (headlines, the wordmark)
 *   - body:    Switzer (UI and prose)
 *   - mono:    Spline Sans Mono (the data rail, identifiers, the command block)
 */
export const FONTS = {
  display: {
    family: "Cabinet Grotesk",
    stack: '"Cabinet Grotesk", ui-sans-serif, system-ui, sans-serif',
    file: "CabinetGrotesk-Variable.woff2",
    variable: true,
    weightRange: "100 900",
  },
  body: {
    family: "Switzer",
    stack: '"Switzer", ui-sans-serif, system-ui, sans-serif',
    file: "Switzer-Variable.woff2",
    variable: true,
    weightRange: "100 900",
  },
  mono: {
    family: "Spline Sans Mono",
    stack: '"Spline Sans Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace',
    file: "SplineSansMono-Variable.woff2",
    variable: true,
    weightRange: "300 700",
  },
} as const;

/** Canonical brand-mark filenames. Each app serves copies from its own public dir. */
export const BRAND_MARK = "brand-mark.png";
export const BRAND_MARK_DARK = "brand-mark-dark.png";
export const BRAND_MARK_LIGHT = "brand-mark-light.png";
