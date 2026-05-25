export type LoginConfig = {
  clientId: string;
  authorizeUrl: string;
  tokenUrl: string;
  apiBaseUrl: string;
};

// Operator must publish the WorkOS Public OAuth (Connect) app's public client_id
// here before `agent-paste login` works end to end. The placeholder is inert:
// login aborts with a clear message rather than hitting WorkOS with it.
const CLI_CLIENT_ID_PLACEHOLDER = "REPLACE_WITH_CLI_PUBLIC_CLIENT_ID";

// Connect authorize/token live on the app's AuthKit domain
// (https://<subdomain>.authkit.app/oauth2/*), not api.workos.com. We do not
// hardcode a guessed subdomain; the operator supplies the base via env, and the
// authorize/token paths are appended (ADR 0060).
const DEFAULT_WORKOS_BASE_URL = "https://api.workos.com";

export function loadLoginConfig(env: Record<string, string | undefined> = process.env): LoginConfig {
  const clientId = env.AGENT_PASTE_WORKOS_CLIENT_ID ?? CLI_CLIENT_ID_PLACEHOLDER;
  const base = trimSlash(env.AGENT_PASTE_WORKOS_BASE_URL ?? DEFAULT_WORKOS_BASE_URL);
  const authorizeUrl = env.AGENT_PASTE_WORKOS_AUTHORIZE_URL ?? `${base}/oauth2/authorize`;
  const tokenUrl = env.AGENT_PASTE_WORKOS_TOKEN_URL ?? `${base}/oauth2/token`;
  const apiBaseUrl = trimSlash(env.AGENT_PASTE_API_URL ?? "https://api.agent-paste.sh");
  return { clientId, authorizeUrl, tokenUrl, apiBaseUrl };
}

export function isPlaceholderClientId(clientId: string): boolean {
  return clientId === CLI_CLIENT_ID_PLACEHOLDER || clientId.length === 0;
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
