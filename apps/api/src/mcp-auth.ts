import {
  MCP_RESOURCE_INDICATOR,
  type McpScope,
  mcpScopeClaimIncludesMemberOnlyScopes,
  mcpScopesToApiScopes,
  parseMcpScopeClaim,
} from "@agent-paste/contracts";
import type { ApiActor } from "@agent-paste/db";
import {
  fetchWorkOsUser,
  verifyWorkOsAccessToken,
  type WorkOsIdentity,
  type WorkOsVerificationOptions,
} from "./workos.js";

export type McpAuthEnv = {
  WORKOS_API_KEY?: string;
  WORKOS_API_BASE_URL?: string;
  WORKOS_MCP_AUDIENCE?: string;
  WORKOS_MCP_ISSUER?: string;
  WORKOS_MCP_JWKS_URL?: string;
  WORKOS_CLI_ISSUER?: string;
  WORKOS_CLI_JWKS_URL?: string;
};

export type McpAuthenticatedPrincipal = {
  identity: WorkOsIdentity & { auth_surface: "mcp" };
  actor: ApiActor;
  mcpScopes: readonly McpScope[];
};

function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) {
    return null;
  }
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
  return match?.[1] ?? null;
}

export function mcpVerifyOptions(env: McpAuthEnv): WorkOsVerificationOptions | null {
  const audience = env.WORKOS_MCP_AUDIENCE ?? MCP_RESOURCE_INDICATOR;
  if (!env.WORKOS_API_KEY || !audience) {
    return null;
  }
  const options: WorkOsVerificationOptions = {
    apiKey: env.WORKOS_API_KEY,
    clientId: audience,
    requireClientIdClaim: false,
  };
  if (env.WORKOS_API_BASE_URL) {
    options.apiBaseUrl = env.WORKOS_API_BASE_URL;
  }
  if (env.WORKOS_MCP_ISSUER) {
    options.issuers = [env.WORKOS_MCP_ISSUER];
  } else if (env.WORKOS_CLI_ISSUER) {
    options.issuers = [env.WORKOS_CLI_ISSUER];
  }
  if (env.WORKOS_MCP_JWKS_URL) {
    options.jwksUrl = env.WORKOS_MCP_JWKS_URL;
  } else if (env.WORKOS_CLI_JWKS_URL) {
    options.jwksUrl = env.WORKOS_CLI_JWKS_URL;
  }
  return options;
}

export function audienceMatchesMcpResource(aud: unknown, resource: string): boolean {
  if (typeof aud === "string") {
    return aud === resource;
  }
  if (Array.isArray(aud)) {
    return aud.some((entry) => typeof entry === "string" && entry === resource);
  }
  return false;
}

export async function authenticateMcpBearer(
  request: Request,
  env: McpAuthEnv,
): Promise<McpAuthenticatedPrincipal | null> {
  const token = bearerToken(request);
  if (!token) {
    return null;
  }
  if (token.startsWith("ap_pk_")) {
    return null;
  }

  const resource = env.WORKOS_MCP_AUDIENCE ?? MCP_RESOURCE_INDICATOR;
  const options = mcpVerifyOptions(env);
  if (!options) {
    return null;
  }

  const verified = await verifyWorkOsAccessToken(token, options);
  if (!verified) {
    return null;
  }
  if (!audienceMatchesMcpResource(verified.payload.aud, resource)) {
    return null;
  }
  if (mcpScopeClaimIncludesMemberOnlyScopes(verified.payload.scope)) {
    return null;
  }

  const mcpScopes = parseMcpScopeClaim(verified.payload.scope);
  const user = await fetchWorkOsUser(verified.sub, options);
  if (!user) {
    return null;
  }

  const identity: WorkOsIdentity & { auth_surface: "mcp" } = {
    workos_user_id: user.id,
    email: user.email,
    auth_surface: "mcp",
  };

  const apiScopes = mcpScopesToApiScopes(mcpScopes);
  return {
    identity,
    actor: {
      type: "member" as const,
      id: "",
      workspace_id: "",
      email: user.email,
      scopes: apiScopes,
    },
    mcpScopes,
  };
}

export async function resolveMcpMemberActor(
  principal: McpAuthenticatedPrincipal,
  db: { getWebMemberByWorkOsUserId(input: { workosUserId: string }): Promise<ApiActor | null> },
): Promise<ApiActor | null> {
  const member = await db.getWebMemberByWorkOsUserId({ workosUserId: principal.identity.workos_user_id });
  if (!member || member.type !== "member") {
    return null;
  }
  return {
    ...member,
    scopes: mcpScopesToApiScopes(principal.mcpScopes),
  };
}
