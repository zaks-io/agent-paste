export type LoginConfig = {
  clientId: string;
  authorizeUrl: string;
  tokenUrl: string;
  apiBaseUrl: string;
};

// Public client_id of the dedicated WorkOS Public OAuth (Connect) app for the
// CLI. Public identifier, safe to ship; override with AGENT_PASTE_WORKOS_CLIENT_ID.
// Defaults target the production WorkOS environment; preview/staging via overrides.
const DEFAULT_CLI_CLIENT_ID = "client_01KSED1S5WMWBYCFWQZX2FHNED";

// Connect authorize/token live on the app's AuthKit domain
// (https://<subdomain>.authkit.app/oauth2/*), not api.workos.com. Production
// environment domain; override with AGENT_PASTE_WORKOS_BASE_URL.
const DEFAULT_WORKOS_BASE_URL = "https://soulful-path-50.authkit.app";

export function loadLoginConfig(env: Record<string, string | undefined> = process.env): LoginConfig {
  const clientId = env.AGENT_PASTE_WORKOS_CLIENT_ID ?? DEFAULT_CLI_CLIENT_ID;
  const base = trimSlash(env.AGENT_PASTE_WORKOS_BASE_URL ?? DEFAULT_WORKOS_BASE_URL);
  const authorizeUrl = env.AGENT_PASTE_WORKOS_AUTHORIZE_URL ?? `${base}/oauth2/authorize`;
  const tokenUrl = env.AGENT_PASTE_WORKOS_TOKEN_URL ?? `${base}/oauth2/token`;
  const apiBaseUrl = trimSlash(env.AGENT_PASTE_API_URL ?? "https://api.agent-paste.sh");
  return { clientId, authorizeUrl, tokenUrl, apiBaseUrl };
}

export function isPlaceholderClientId(clientId: string): boolean {
  return clientId.length === 0 || clientId === "REPLACE_WITH_CLI_PUBLIC_CLIENT_ID";
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
