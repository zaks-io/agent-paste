/**
 * Cross-surface theme persistence. The marketing site (apps/apex, agent-paste.sh)
 * and the dashboard (apps/web, app.agent-paste.sh) are different origins, so
 * localStorage cannot be shared. A cookie scoped to the registrable parent domain
 * (`.agent-paste.sh`) IS visible to both, so it is the single source of truth for
 * the theme preference — set it on one surface, the other reads it.
 *
 * Both surfaces must agree on the exact name + domain, so that logic lives here,
 * once. The apex first-paint init is a tiny inline (CSP-pinned) script that
 * reimplements the read inline; keep it in sync with readThemeCookie() — there is
 * a test pinning the relationship.
 */

export type ThemePreference = "light" | "dark" | "system";

/** The shared cookie name. One key, both surfaces. */
export const THEME_COOKIE = "agp_theme";

/**
 * The cookie Domain for a given hostname: the registrable parent so every
 * subdomain shares it. `app.preview.agent-paste.sh` -> `.preview.agent-paste.sh`,
 * `agent-paste.sh`/`app.agent-paste.sh` -> `.agent-paste.sh`. localhost / IPs /
 * *.workers.dev get no Domain (host-only cookie), which is correct for those.
 */
export function themeCookieDomain(hostname: string): string | null {
  if (hostname.endsWith(".agent-paste.sh") || hostname === "agent-paste.sh") {
    return hostname.includes(".preview.agent-paste.sh") || hostname === "preview.agent-paste.sh"
      ? ".preview.agent-paste.sh"
      : ".agent-paste.sh";
  }
  return null;
}

function isPreference(value: string | undefined | null): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

/** Read the theme preference from document.cookie, or null if unset/invalid. */
export function readThemeCookie(cookieString: string): ThemePreference | null {
  for (const part of cookieString.split(";")) {
    const [rawName, ...rest] = part.split("=");
    if (rawName?.trim() === THEME_COOKIE) {
      const value = rest.join("=").trim();
      return isPreference(value) ? value : null;
    }
  }
  return null;
}

/**
 * Build the `document.cookie` assignment string for a preference. 1-year max-age,
 * Lax (top-level navigation between the two surfaces must carry it), root path,
 * Secure on https. Domain comes from themeCookieDomain(hostname).
 */
export function buildThemeCookie(value: ThemePreference, hostname: string, secure: boolean): string {
  const domain = themeCookieDomain(hostname);
  const attrs = [
    `${THEME_COOKIE}=${value}`,
    "Path=/",
    "Max-Age=31536000",
    "SameSite=Lax",
    domain ? `Domain=${domain}` : "",
    secure ? "Secure" : "",
  ].filter(Boolean);
  return attrs.join("; ");
}
