import { createRemoteJWKSet, jwtVerify } from "jose";

export function getOperatorEmails(operatorEmails: string | undefined): readonly string[] {
  if (!operatorEmails) {
    return [];
  }
  return operatorEmails
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

export function isOperator(operatorEmails: string | undefined, email: string | null | undefined): boolean {
  if (!email) {
    return false;
  }
  return getOperatorEmails(operatorEmails).includes(email.toLowerCase());
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
    return typeof commonName === "string" && commonName.length > 0 ? commonName : null;
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
