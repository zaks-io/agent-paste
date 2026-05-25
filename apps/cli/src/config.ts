export type LoginConfig = {
  clientId: string;
  authorizeUrl: string;
  tokenUrl: string;
  apiBaseUrl: string;
  loginPort: number;
};

// WorkOS allows a wildcard loopback redirect, but the *default* redirect URI must
// be exact (no wildcard). The CLI binds a fixed default port so
// http://127.0.0.1:8975/callback can be registered as that exact default. Override
// with AGENT_PASTE_LOGIN_PORT if it collides; the new port must match a registered
// redirect URI (a wildcard registration covers any port). 0 means an OS-assigned
// port (tests only).
const DEFAULT_LOGIN_PORT = 8975;

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
  const loginPort = parsePort(env.AGENT_PASTE_LOGIN_PORT) ?? DEFAULT_LOGIN_PORT;
  return { clientId, authorizeUrl, tokenUrl, apiBaseUrl, loginPort };
}

function parsePort(value: string | undefined): number | null {
  if (value === undefined) {
    return null;
  }
  // Number("") and Number("   ") are 0, which would silently bind the ephemeral
  // port instead of the fixed default. Require digits only so blank/garbage env
  // values fall back to DEFAULT_LOGIN_PORT.
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) {
    return null;
  }
  const port = Number.parseInt(normalized, 10);
  return port <= 65535 ? port : null;
}

export function isPlaceholderClientId(clientId: string): boolean {
  return clientId.length === 0 || clientId === "REPLACE_WITH_CLI_PUBLIC_CLIENT_ID";
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
