export const APP_ORIGIN = "https://app.agent-paste.sh";

const PRODUCT_PREFIXES = [
  "/dashboard",
  "/artifacts",
  "/keys",
  "/audit",
  "/settings",
  "/admin",
  "/al/",
  "/r/",
  "/login",
  "/logout",
  "/auth/",
] as const;

export function productRedirect(url: URL): string | null {
  const path = url.pathname;
  const match = PRODUCT_PREFIXES.some(
    (prefix) =>
      path === prefix || path === `${prefix}/` || path.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`),
  );
  if (!match) {
    return null;
  }
  return `${APP_ORIGIN}${path}${url.search}`;
}
