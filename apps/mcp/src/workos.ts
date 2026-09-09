import {
  audienceMatchesMcpResource,
  type McpAuthEnv,
  mcpVerifyOptions,
  verifyWorkOsAccessToken,
} from "@agent-paste/auth";
import { MCP_RESOURCE_INDICATOR } from "@agent-paste/contracts";

export type McpWorkOsEnv = McpAuthEnv & {
  MCP_RESOURCE?: string;
};

export async function verifyMcpOAuthToken(token: string, env: McpWorkOsEnv): Promise<{ tokenSub: string } | null> {
  const resource = env.WORKOS_MCP_AUDIENCE ?? env.MCP_RESOURCE ?? MCP_RESOURCE_INDICATOR;
  const options = mcpVerifyOptions({ ...env, WORKOS_MCP_AUDIENCE: resource });
  if (!options) {
    return null;
  }
  options.throwOnUnavailable = true;
  const verified = await verifyWorkOsAccessToken(token, options);
  if (!verified || !audienceMatchesMcpResource(verified.payload.aud, resource)) {
    return null;
  }
  return { tokenSub: verified.sub };
}

export function isConfiguredMcpOAuthVerifier(env: McpWorkOsEnv): boolean {
  return Boolean(env.WORKOS_API_KEY && env.WORKOS_MCP_ISSUER && env.WORKOS_MCP_JWKS_URL);
}

/** @internal test helper */
export function audienceFromPayload(payload: { aud?: unknown }, resource: string): boolean {
  return audienceMatchesMcpResource(payload.aud, resource);
}
