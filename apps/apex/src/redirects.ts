export const APP_ORIGIN = "https://app.agent-paste.sh";

const PRODUCT_PREFIXES = ["/dashboard", "/artifacts", "/keys", "/audit", "/settings", "/admin", "/al/", "/r/"] as const;

// Vanity auth paths typed against the apex domain. The app has no /login or
// /logout route, so map them to its real auth entry points rather than
// forwarding the path verbatim (which 404s). The WorkOS callback always targets
// the app domain directly, so apex never forwards /api/auth/* itself.
const AUTH_ALIASES: Record<string, string> = {
  "/login": "/api/auth/sign-in",
  "/logout": "/api/auth/sign-out",
};

export function productRedirect(url: URL): string | null {
  const path = url.pathname;
  const alias = AUTH_ALIASES[path.replace(/\/$/, "")];
  if (alias) {
    return `${APP_ORIGIN}${alias}${url.search}`;
  }
  const match = PRODUCT_PREFIXES.some(
    (prefix) =>
      path === prefix || path === `${prefix}/` || path.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`),
  );
  if (!match) {
    return null;
  }
  return `${APP_ORIGIN}${path}${url.search}`;
}
