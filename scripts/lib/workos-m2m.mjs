// Mints a fresh WorkOS access token at smoke-test time via the M2M
// client_credentials grant, per ADR 0078. The durable credential (client_secret)
// is stored; the perishable access token is never stored — it is minted per run,
// so it cannot go stale the way a pre-minted stored token does.
//
// WorkOS token endpoint: POST <authServer>/oauth2/token with
//   grant_type=client_credentials, client_id, client_secret[, scope]
// (application/x-www-form-urlencoded). The client_secret is long-lived; the
// returned access_token is short-lived.

/**
 * @typedef {Object} M2MCredentials
 * @property {string} tokenUrl Full token endpoint, e.g. https://x.authkit.app/oauth2/token
 * @property {string} clientId WorkOS M2M client id.
 * @property {string} clientSecret WorkOS M2M client secret (long-lived).
 * @property {string} [scope] Optional space-separated scopes.
 */

/**
 * Resolve M2M credentials for a smoke surface from the environment. Returns null
 * when not configured, so callers can skip loudly instead of failing.
 *
 * Reads, in order of preference:
 *   <PREFIX>_WORKOS_M2M_CLIENT_ID / _CLIENT_SECRET / _TOKEN_URL / _SCOPE
 * where PREFIX is e.g. AGENT_PASTE_EPHEMERAL_SMOKE or AGENT_PASTE_MCP_SMOKE.
 *
 * @param {string} prefix
 * @param {NodeJS.ProcessEnv} [source]
 * @returns {M2MCredentials|null}
 */
export function resolveM2MCredentials(prefix, source = process.env) {
  const clientId = source[`${prefix}_WORKOS_M2M_CLIENT_ID`];
  const clientSecret = source[`${prefix}_WORKOS_M2M_CLIENT_SECRET`];
  const tokenUrl = source[`${prefix}_WORKOS_M2M_TOKEN_URL`];
  if (!clientId || !clientSecret || !tokenUrl) {
    return null;
  }
  const scope = source[`${prefix}_WORKOS_M2M_SCOPE`];
  return { tokenUrl, clientId, clientSecret, scope: scope || undefined };
}

/**
 * Exchange M2M credentials for a fresh access token.
 * @param {M2MCredentials} credentials
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<string>} the access_token
 */
export async function mintWorkOsM2MToken(credentials, fetchImpl = fetch) {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
  });
  if (credentials.scope) {
    body.set("scope", credentials.scope);
  }
  const response = await fetchImpl(credentials.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    // Fail fast: a hung token endpoint must not stall the smoke run indefinitely.
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`WorkOS M2M token mint failed (${response.status}): ${detail.slice(0, 200)}`);
  }
  const payload = await response.json();
  if (!payload || typeof payload.access_token !== "string") {
    throw new Error("WorkOS M2M token response had no access_token");
  }
  return payload.access_token;
}

/**
 * Convenience: resolve credentials for `prefix` and mint a token, or return null
 * (with a reason) when the surface is not configured for M2M.
 * @param {string} prefix
 * @param {{ source?: NodeJS.ProcessEnv, fetchImpl?: typeof fetch }} [opts]
 * @returns {Promise<{ token: string } | { token: null, reason: string }>}
 */
export async function mintForPrefix(prefix, opts = {}) {
  const credentials = resolveM2MCredentials(prefix, opts.source);
  if (!credentials) {
    return {
      token: null,
      reason: `${prefix}_WORKOS_M2M_CLIENT_ID/_CLIENT_SECRET/_TOKEN_URL not set`,
    };
  }
  const token = await mintWorkOsM2MToken(credentials, opts.fetchImpl);
  return { token };
}
