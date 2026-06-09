import {
  NEXT_THEME,
  THEME_ICON,
  THEME_ICON_CLASS,
  THEME_TOGGLE_CLASS,
  type ThemeState,
  themeToggleAria,
} from "@agent-paste/ui";
import { useTheme } from "../theme-provider";

/*
 * The dashboard's driver for the shared header toggle. The look (button class,
 * icon SVGs, cycle order, aria copy) all come from @agent-paste/ui so it is
 * byte-identical to the marketing header's toggle (apps/apex). React only
 * supplies the live state via useTheme; everything visual is shared.
 */
export function ThemeToggle() {
  const { preference, setPreference } = useTheme();
  const state = preference as ThemeState;

  return (
    <button
      type="button"
      onClick={() => setPreference(NEXT_THEME[state])}
      aria-label={themeToggleAria(state)}
      title={themeToggleAria(state)}
      className={THEME_TOGGLE_CLASS}
    >
      {/* Shared glyph: same SVG string the apex script injects for this state. */}
      <span
        aria-hidden
        className={THEME_ICON_CLASS}
        // biome-ignore lint/security/noDangerouslySetInnerHtml: a static, in-repo SVG constant from @agent-paste/ui (no user input); the apex twin injects the same string.
        dangerouslySetInnerHTML={{ __html: THEME_ICON[state] }}
      />
    </button>
  );
}
