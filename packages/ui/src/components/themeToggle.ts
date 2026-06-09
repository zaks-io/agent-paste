/**
 * The single source for the header theme toggle, shared by BOTH surfaces so they
 * cannot drift. apps/apex (static SSG marketing) drives it with a framework-free
 * DOM script; apps/web (live React) drives it with useTheme. Neither owns the
 * look — these constants do. Same markup, same icons, same accent, one cookie.
 *
 * The toggle is a square icon-only button cycling system -> dark -> light. The
 * icon is the ONLY thing that changes per state; both drivers swap `.tt-icon`'s
 * inner SVG and the aria/title text. Keep the three icons here, once.
 */

export type ThemeState = "system" | "dark" | "light";

/** The cycle order: tapping the toggle advances to the next state. */
export const THEME_CYCLE: readonly ThemeState[] = ["system", "dark", "light"];

/** The state a given state advances to on click (for aria copy + drivers). */
export const NEXT_THEME: Record<ThemeState, ThemeState> = {
  system: "dark",
  dark: "light",
  light: "system",
};

/**
 * The three state icons as raw <svg> strings (16x16, currentColor). Raw strings,
 * not JSX, so the framework-free apex script can inject them with innerHTML and
 * the web React wrapper can render the same glyph. One drawing per state, shared.
 */
export const THEME_ICON: Record<ThemeState, string> = {
  system:
    '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="1.7" y="2.5" width="12.6" height="8.4" rx="1.2" stroke="currentColor" stroke-width="1.3"/><path d="M5.6 13.5h4.8M8 11v2.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
  dark: '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M13.5 9.3A5.5 5.5 0 0 1 6.7 2.5 5.5 5.5 0 1 0 13.5 9.3Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>',
  light:
    '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="3.2" stroke="currentColor" stroke-width="1.3"/><path d="M8 .8v1.8M8 13.4v1.8M.8 8h1.8M13.4 8h1.8M3 3l1.2 1.2M11.8 11.8 13 13M13 3l-1.2 1.2M4.2 11.8 3 13" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
};

/** Human label per state, for the toggle's aria-label / title. */
export const THEME_LABEL: Record<ThemeState, string> = {
  system: "System",
  dark: "Dark",
  light: "Light",
};

/** aria-label describing the current state and what a click does. */
export function themeToggleAria(state: ThemeState): string {
  return `Theme: ${THEME_LABEL[state].toLowerCase()}. Switch to ${THEME_LABEL[NEXT_THEME[state]].toLowerCase()}.`;
}

/**
 * The toggle button's class string. One square icon button: borderless, hover
 * tint, accent focus ring. Identical on both surfaces. The inner glyph lives in
 * a `.tt-icon` span so each driver can repaint it without re-classing the button.
 */
export const THEME_TOGGLE_CLASS =
  "grid place-items-center h-8 w-8 rounded-sm cursor-pointer bg-transparent border-0 " +
  "text-muted hover:text-foreground hover:bg-surface-2 " +
  "transition-colors duration-150 ease-out " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

/** The class for the inner icon span — sizes the swapped-in SVG to 16px. */
export const THEME_ICON_CLASS = "[&>svg]:block [&>svg]:h-4 [&>svg]:w-4";
