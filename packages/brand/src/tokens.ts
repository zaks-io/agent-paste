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
 *   - One accent: electric violet, one job (primary action, focus, live-state).
 *   - Cool indigo-black ladder for depth via lightness steps of one hue.
 *   - Warm-cool tension: cool dark canvas under a faintly warm ink.
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
  /** The one accent: electric violet. */
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

/** Dark is the product. These match globals.css `:root, [data-theme="dark"]`. */
export const DARK: ThemeTokens = {
  background: "240 16% 6%",
  surface: "240 13% 9%",
  surface2: "240 12% 12%",
  surface3: "240 11% 16%",
  rule: "240 9% 18%",
  ruleStrong: "240 9% 26%",
  foreground: "250 30% 96%",
  muted: "245 12% 78%",
  subtle: "240 8% 58%",
  faint: "240 7% 40%",
  accent: "248 73% 64%",
  accentDim: "248 50% 46%",
  accentFg: "250 40% 97%",
  accentTint: "248 73% 64% / 0.14",
  selection: "248 73% 64% / 0.3",
  success: "152 56% 52%",
  warning: "36 84% 58%",
  destructive: "4 72% 60%",
};

/** Light alternate: warm paper, violet stays the voltage. Matches `[data-theme="light"]`. */
export const LIGHT: ThemeTokens = {
  background: "40 30% 97%",
  surface: "40 33% 99.5%",
  surface2: "40 20% 94%",
  surface3: "38 16% 90%",
  rule: "36 14% 86%",
  ruleStrong: "34 12% 76%",
  foreground: "250 22% 12%",
  muted: "245 10% 34%",
  subtle: "240 7% 48%",
  faint: "240 6% 62%",
  accent: "248 64% 56%",
  accentDim: "248 50% 46%",
  accentFg: "250 40% 98%",
  accentTint: "248 64% 56% / 0.1",
  selection: "248 64% 56% / 0.16",
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
 * Brand fonts. Family names match the @fontsource packages the web app imports;
 * `webImports` are the npm CSS entrypoints; `apexFiles` are the self-hosted woff2
 * filenames the apex worker serves from its public/fonts dir (it cannot import
 * from npm at request time).
 */
export const FONTS = {
  display: {
    family: "Bricolage Grotesque Variable",
    stack: '"Bricolage Grotesque Variable", ui-sans-serif, system-ui, sans-serif',
    webImport: "@fontsource-variable/bricolage-grotesque/opsz.css",
    apexFile: "BricolageGrotesque-Variable.woff2",
    /** Variable optical-size axis; emit with format("woff2-variations"). */
    variable: true,
    weightRange: "200 800",
  },
  mono: {
    family: "IBM Plex Mono",
    stack: '"IBM Plex Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace',
    webImports: ["@fontsource/ibm-plex-mono/400.css", "@fontsource/ibm-plex-mono/500.css"],
    apexFiles: { 400: "IBMPlexMono-Regular.woff2", 500: "IBMPlexMono-Medium.woff2" },
    variable: false,
  },
} as const;

/** Canonical brand-mark filename. Each app serves a copy from its own public dir. */
export const BRAND_MARK = "brand-mark.png";
