import os from "node:os";
import { ApiClient, createIdempotencyKey } from "@agent-paste/api-client";
import { CreateApiKeyRequest } from "@agent-paste/contracts";
import { isPlaceholderClientId, type LoginConfig, loadLoginConfig } from "./config.js";
import { type Credential, type CredentialStore, credentialStore } from "./credentials.js";
import { openBrowser, startLoopbackServer } from "./loopback.js";
import { createPkce } from "./pkce.js";

export type LoginDeps = {
  config?: LoginConfig;
  fetch?: typeof fetch;
  log?: (message: string) => void;
  store?: CredentialStore;
  openBrowser?: (url: string) => void;
};

type TokenResponse = {
  access_token: string;
  id_token?: string;
};

export async function login(deps: LoginDeps = {}): Promise<Credential> {
  const config = deps.config ?? loadLoginConfig();
  const fetchImpl = deps.fetch ?? fetch;
  const log = deps.log ?? ((message: string) => process.stderr.write(`${message}\n`));
  const store = deps.store ?? credentialStore();
  const open = deps.openBrowser ?? openBrowser;

  if (isPlaceholderClientId(config.clientId)) {
    throw new Error(
      "WorkOS CLI client is not configured. Set AGENT_PASTE_WORKOS_CLIENT_ID to the Public OAuth (Connect) app client_id.",
    );
  }

  const pkce = createPkce();
  const server = await startLoopbackServer(pkce.state, config.loginPort);
  try {
    const authorizeUrl = buildAuthorizeUrl(config, server.redirectUri, pkce.challenge, pkce.state);
    log(`Opening your browser to sign in. If it does not open, visit:\n${authorizeUrl}`);
    open(authorizeUrl);

    const { code } = await server.waitForCallback();
    const token = await exchangeCode(fetchImpl, config, code, server.redirectUri, pkce.verifier);

    const credential = await mintCredential(config, token, fetchImpl);
    await store.save(credential);
    log(`Signed in as ${credential.member_email}. Stored API key ${credential.public_id}.`);
    return credential;
  } finally {
    await server.close();
  }
}

function buildAuthorizeUrl(config: LoginConfig, redirectUri: string, challenge: string, state: string): string {
  const url = new URL(config.authorizeUrl);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid profile email");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

async function exchangeCode(
  fetchImpl: typeof fetch,
  config: LoginConfig,
  code: string,
  redirectUri: string,
  verifier: string,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: config.clientId,
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  });
  const response = await fetchImpl(config.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: body.toString(),
  });
  if (!response.ok) {
    throw new Error(`Token exchange failed with status ${response.status}`);
  }
  const parsed = (await response.json()) as TokenResponse;
  if (!parsed.access_token) {
    throw new Error("Token exchange returned no access_token.");
  }
  return parsed;
}

// The WorkOS access token is used only to mint the durable API key, then
// discarded. The minted key is hardcoded server-side to publish+read scope, so
// the CLI is structurally less powerful than the dashboard (ADR 0060).
async function mintCredential(config: LoginConfig, token: TokenResponse, fetchImpl: typeof fetch): Promise<Credential> {
  const client = new ApiClient({
    auth: { type: "bearer", getAccessToken: () => token.access_token },
    apiBaseUrl: config.apiBaseUrl,
    fetch: fetchImpl,
  });
  const request = CreateApiKeyRequest.parse({ name: `agent-paste CLI (${os.hostname()})` });
  const result = await client.web.keys.create(request, createIdempotencyKey("cli_login_mint"));
  return {
    api_key: result.secret,
    public_id: result.api_key.public_id,
    workspace_id: result.api_key.workspace_id,
    member_email: emailFromIdToken(token.id_token) ?? "unknown",
  };
}

function emailFromIdToken(idToken: string | undefined): string | null {
  if (!idToken) {
    return null;
  }
  const payload = idToken.split(".")[1];
  if (!payload) {
    return null;
  }
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { email?: unknown };
    return typeof decoded.email === "string" ? decoded.email : null;
  } catch {
    return null;
  }
}
