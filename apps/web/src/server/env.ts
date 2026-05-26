export type WebEnv = {
  AGENT_PASTE_ENV: "dev" | "preview" | "production";
  API_BASE_URL: string;
  WEB_BASE_URL: string;
  WORKOS_CLIENT_ID: string;
  WORKOS_API_KEY: string;
  WORKOS_REDIRECT_URI: string;
  WORKOS_COOKIE_PASSWORD: string;
  WORKOS_COOKIE_NAME?: string;
  ASSETS: Fetcher;
  API?: Fetcher;
  SENTRY_DSN?: string;
};

export const OPERATOR_ROLE_SLUG = "admin";

export type WorkOsRoleClaims = {
  role?: string;
  roles?: readonly string[];
};

export function hasOperatorRole(claims: WorkOsRoleClaims): boolean {
  return claims.role === OPERATOR_ROLE_SLUG || claims.roles?.includes(OPERATOR_ROLE_SLUG) === true;
}
