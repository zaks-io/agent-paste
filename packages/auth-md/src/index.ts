/**
 * The auth.md agent-registration skill document and the protocol URNs it names.
 *
 * Field and endpoint vocabulary tracks the upstream WorkOS auth.md spec
 * (https://github.com/workos/auth.md). The v0.1.0 names `register_uri`,
 * `claim_uri`, and `revocation_uri` were renamed to `identity_endpoint`,
 * `claim_endpoint`, and `events_endpoint` in spec v0.2.0 and v0.3.0; do not
 * reintroduce them.
 */

export const AGENT_AUTH_ID_JAG_ASSERTION_TYPE = "urn:ietf:params:oauth:token-type:id-jag";
export const AGENT_AUTH_JWT_BEARER_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:jwt-bearer";
export const AGENT_AUTH_CLAIM_GRANT_TYPE = "urn:workos:agent-auth:grant-type:claim";
export const AGENT_AUTH_REVOKED_EVENT = "https://schemas.workos.com/events/agent/auth/identity/assertion/revoked";

export const AUTH_MD_PATH = "/auth.md";
export const AUTH_MD_CONTENT_TYPE = "text/markdown; charset=utf-8";

/**
 * Renders the document served at `/auth.md`.
 *
 * The first line is an H1 carrying the literal `auth.md`, which is how discovery
 * scanners confirm the response is an auth.md skill and not an unrelated page.
 *
 * `issuer` is the agent-auth authorization server origin, with no trailing
 * slash. The document is a pure function of it so every origin that serves
 * `/auth.md` renders the same text; live capability (which registration types
 * are actually enabled) belongs in the authorization server metadata, which the
 * document points at rather than restating.
 */
export function renderAuthMd(input: { issuer: string }): string {
  const { issuer } = input;
  return [
    "# Agent Paste auth.md",
    "",
    "Agent Paste lets agents register with WorkOS auth.md verified and user-claimed flows. Use the CLI when you can run commands; use this HTTP flow when you are implementing an auth.md client directly.",
    "",
    `Protected Resource Metadata: ${issuer}/.well-known/oauth-protected-resource`,
    `Authorization Server Metadata: ${issuer}/.well-known/oauth-authorization-server`,
    `Agent identity endpoint: ${issuer}/agent/identity`,
    "",
    "Supported registration types are advertised as agent_auth.identity_types_supported in the Authorization Server Metadata. Read them there; this document describes every flow Agent Paste can serve, not what one deployment has enabled.",
    "",
    "Scopes:",
    "- read: inspect account and Artifact metadata.",
    "- publish: publish and revise Artifacts.",
    "",
    "Anonymous user-claimed flow:",
    '1. POST /agent/identity with {"type":"anonymous"}. Store registration_id, identity_assertion, and claim_token.',
    `2. Exchange identity_assertion at /oauth2/token with grant_type=${AGENT_AUTH_JWT_BEARER_GRANT_TYPE}. The access token is pre-claim, scoped to read/publish on the ephemeral workspace only.`,
    "3. Publish with the pre-claim access token. Because the registration is backed by an ephemeral workspace, publish returns `url` for immediate no-login viewing.",
    '4. When the human wants to keep or own the Artifact, POST /agent/identity/claim with {"claim_token":"..."}. Show the returned user_code and open claim.verification_uri in the browser.',
    `5. Poll /oauth2/token with grant_type=${AGENT_AUTH_CLAIM_GRANT_TYPE} and claim_token. Before browser completion it returns authorization_pending. After completion it returns a user-backed access token and revokes pre-claim credentials.`,
    "",
    "Browser claim rules:",
    "- claim_url from /agent/identity is the API claim endpoint, not the browser URL.",
    "- claim.verification_uri from /agent/identity/claim is the browser URL to open.",
    "- The browser claim requires a signed-in WorkOS session.",
    "- The signed-in browser session determines the destination Agent Paste Workspace.",
    "- The claim code must match the user_code from /agent/identity/claim.",
    "",
    "Provider identity_assertion flow:",
    "- Use it only when identity_assertion is listed in agent_auth.identity_types_supported and your provider can send a signed ID-JAG.",
    "- If the response is interaction_required, show the returned code and verification URI, then poll the claim-token grant.",
    "",
    "Agent Paste does not support service_auth agent registration.",
  ].join("\n");
}
