import { buildThemeCookie, readThemeCookie } from "@agent-paste/ui";
import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useEffect, useState } from "react";

export type Theme = "light" | "dark";
type Resolved = Theme;
type Preference = Theme | "system";

type Ctx = {
  theme: Resolved;
  preference: Preference;
  setPreference: (next: Preference) => void;
};

const ThemeContext = createContext<Ctx | null>(null);

// The preference is persisted in a cookie scoped to the registrable parent domain
// (.agent-paste.sh), so it is shared with the marketing site (apps/apex). Setting
// the theme on either surface carries to the other. See @agent-paste/brand.
function readPreference(): Preference {
  if (typeof document === "undefined") return "system";
  return readThemeCookie(document.cookie) ?? "system";
}

function writePreference(next: Preference) {
  if (typeof document === "undefined") return;
  // biome-ignore lint/suspicious/noDocumentCookie: the async Cookie Store API can't be read by the apex synchronous first-paint script; document.cookie is the shared mechanism both surfaces use.
  document.cookie = buildThemeCookie(next, window.location.hostname, window.location.protocol === "https:");
}

function systemPrefersDark(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyTheme(theme: Resolved) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<Preference>(() => readPreference());
  const [systemDark, setSystemDark] = useState(() => systemPrefersDark());

  const resolved: Resolved = preference === "system" ? (systemDark ? "dark" : "light") : preference;

  useEffect(() => {
    applyTheme(resolved);
  }, [resolved]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    media.addEventListener("change", handler);
    return () => media.removeEventListener("change", handler);
  }, []);

  const setPreference = useCallback((next: Preference) => {
    setPreferenceState(next);
    writePreference(next);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme: resolved, preference, setPreference }}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): Ctx {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
}
