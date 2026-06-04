import { MCP_RESOURCE_INDICATOR } from "@agent-paste/contracts";
import { createRemoteJWKSet, type JWTPayload, jwtVerify } from "jose";

export type McpWorkOsEnv = {
  WORKOS_API_KEY?: string;
  WORKOS_API_BASE_URL?: string;
  MCP_RESOURCE?: string;
  WORKOS_MCP_AUDIENCE?: string;
  WORKOS_MCP_ISSUER?: string;
  WORKOS_MCP_JWKS_URL?: string;
  WORKOS_CLI_ISSUER?: string;
  WORKOS_CLI_JWKS_URL?: string;
};

const WORKOS_JWKS_CACHE_MAX_AGE_MS = 60 * 60 * 1000;
const remoteJwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function audienceMatches(aud: unknown, resource: string): boolean {
  if (typeof aud === "string") {
    return aud === resource;
  }
  if (Array.isArray(aud)) {
    return aud.some((entry) => typeof entry === "string" && entry === resource);
  }
  return false;
}

function issuerMatches(actual: string | undefined, expected: readonly string[] | undefined): boolean {
  if (!actual || !expected || expected.length === 0) {
    return false;
  }
  const normalized = actual.replace(/\/+$/, "");
  return expected.some((issuer) => issuer.replace(/\/+$/, "") === normalized);
}

function remoteJwks(env: McpWorkOsEnv): ReturnType<typeof createRemoteJWKSet> | null {
  const jwksUrl = env.WORKOS_MCP_JWKS_URL ?? env.WORKOS_CLI_JWKS_URL;
  const apiKey = env.WORKOS_API_KEY;
  if (!jwksUrl || !apiKey) {
    return null;
  }
  const authorization = `Bearer ${apiKey}`;
  const cacheKey = `${jwksUrl}:${authorization}`;
  const cached = remoteJwksCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const remote = createRemoteJWKSet(new URL(jwksUrl), {
    cacheMaxAge: WORKOS_JWKS_CACHE_MAX_AGE_MS,
    headers: { authorization },
  });
  remoteJwksCache.set(cacheKey, remote);
  return remote;
}

function issuers(env: McpWorkOsEnv): string[] {
  if (env.WORKOS_MCP_ISSUER) {
    return [env.WORKOS_MCP_ISSUER];
  }
  if (env.WORKOS_CLI_ISSUER) {
    return [env.WORKOS_CLI_ISSUER];
  }
  return [];
}

export async function verifyMcpOAuthToken(token: string, env: McpWorkOsEnv): Promise<{ tokenSub: string } | null> {
  if (!env.WORKOS_API_KEY) {
    return null;
  }
  const jwks = remoteJwks(env);
  if (!jwks) {
    return null;
  }
  const resource = env.WORKOS_MCP_AUDIENCE ?? env.MCP_RESOURCE ?? MCP_RESOURCE_INDICATOR;
  try {
    const { payload } = await jwtVerify(token, jwks, { algorithms: ["RS256"] });
    if (!payload.sub || typeof payload.exp !== "number") {
      return null;
    }
    if (!issuerMatches(payload.iss, issuers(env))) {
      return null;
    }
    if (!audienceMatches(payload.aud, resource)) {
      return null;
    }
    return { tokenSub: payload.sub };
  } catch {
    return null;
  }
}

export function isConfiguredMcpOAuthVerifier(env: McpWorkOsEnv): boolean {
  return Boolean(env.WORKOS_API_KEY && (env.WORKOS_MCP_JWKS_URL ?? env.WORKOS_CLI_JWKS_URL));
}

/** @internal test helper */
export function audienceFromPayload(payload: JWTPayload, resource: string): boolean {
  return audienceMatches(payload.aud, resource);
}
