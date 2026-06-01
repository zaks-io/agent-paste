import type { WorkOsIdentity } from "@agent-paste/auth";
import { createRemoteJWKSet, jwtVerify } from "jose";

export const OPERATOR_ROLE_SLUG = "admin";

export function isOperator(identity: WorkOsIdentity | null | undefined): boolean {
  if (!identity) {
    return false;
  }
  return identity.role === OPERATOR_ROLE_SLUG || identity.roles?.includes(OPERATOR_ROLE_SLUG) === true;
}

export type CfAccessOptions = {
  teamDomain: string;
  aud: string;
};

const remoteAccessJwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

// Verifies a Cloudflare Access service-token JWT and returns the machine
// identity's common_name. Human Access JWTs (no common_name) are rejected so
// only the rotation agent's service token reaches operator routes (ADR 0046).
export async function verifyCfAccessServiceToken(
  assertion: string | null,
  options: CfAccessOptions,
): Promise<string | null> {
  if (!assertion) {
    return null;
  }
  try {
    const jwks = remoteAccessJwks(options.teamDomain);
    const { payload } = await jwtVerify(assertion, jwks, { algorithms: ["RS256"] });
    const audience = payload.aud;
    const audienceMatches =
      typeof audience === "string"
        ? audience === options.aud
        : Array.isArray(audience) && audience.includes(options.aud);
    if (!audienceMatches) {
      return null;
    }
    const commonName = payload.common_name;
    if (typeof commonName !== "string") {
      return null;
    }
    const normalized = commonName.trim().toLowerCase();
    return normalized.length > 0 ? normalized : null;
  } catch {
    return null;
  }
}

function remoteAccessJwks(teamDomain: string): ReturnType<typeof createRemoteJWKSet> {
  const url = `https://${teamDomain}/cdn-cgi/access/certs`;
  const cached = remoteAccessJwksCache.get(url);
  if (cached) {
    return cached;
  }
  const remote = createRemoteJWKSet(new URL(url));
  remoteAccessJwksCache.set(url, remote);
  return remote;
}
