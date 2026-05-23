import { createRemoteJWKSet, type JWTPayload, jwtVerify } from "jose";

export type WorkOsIdentity = {
  workos_user_id: string;
  email: string;
  session_id?: string;
  token_id?: string;
};

export type WorkOsVerificationOptions = {
  apiKey: string;
  clientId: string;
  apiBaseUrl?: string;
  issuer?: string;
  jwksUrl?: string;
  requireClientIdClaim?: boolean;
};

type WorkOsUser = {
  id: string;
  email: string;
};

const DEFAULT_WORKOS_API_BASE_URL = "https://api.workos.com";
const DEFAULT_WORKOS_ISSUER = "https://api.workos.com";
const remoteJwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export async function resolveWorkOsIdentity(
  bearerValue: string,
  options: WorkOsVerificationOptions,
): Promise<WorkOsIdentity | null> {
  const token = parseBearerToken(bearerValue);
  if (!token) {
    return null;
  }

  const verified = await verifyWorkOsAccessToken(token, options);
  if (!verified) {
    return null;
  }

  const user = await fetchWorkOsUser(verified.sub, options);
  if (!user || user.id !== verified.sub) {
    return null;
  }

  return {
    workos_user_id: user.id,
    email: user.email,
    ...(verified.sessionId ? { session_id: verified.sessionId } : {}),
    ...(verified.tokenId ? { token_id: verified.tokenId } : {}),
  };
}

export async function verifyWorkOsAccessToken(
  token: string,
  options: WorkOsVerificationOptions,
): Promise<{ sub: string; payload: JWTPayload; sessionId?: string; tokenId?: string } | null> {
  try {
    const jwks = remoteWorkOsJwks(options);
    const { payload } = await jwtVerify(token, jwks, { algorithms: ["RS256"] });
    if (
      !payload.sub ||
      typeof payload.exp !== "number" ||
      !issuerMatches(payload.iss, options.issuer ?? DEFAULT_WORKOS_ISSUER)
    ) {
      return null;
    }
    if (!clientIdMatches(payload, options.clientId, options.requireClientIdClaim === true)) {
      return null;
    }
    const sessionId = stringClaim(payload.sid);
    const tokenId = stringClaim(payload.jti);
    return {
      sub: payload.sub,
      payload,
      ...(sessionId ? { sessionId } : {}),
      ...(tokenId ? { tokenId } : {}),
    };
  } catch {
    return null;
  }
}

export async function fetchWorkOsUser(
  workosUserId: string,
  options: Pick<WorkOsVerificationOptions, "apiBaseUrl" | "apiKey">,
): Promise<WorkOsUser | null> {
  try {
    const response = await fetch(
      `${workOsBaseUrl(options.apiBaseUrl)}/user_management/users/${encodeURIComponent(workosUserId)}`,
      {
        headers: { authorization: `Bearer ${options.apiKey}` },
      },
    );
    if (!response.ok) {
      return null;
    }
    const value = await response.json();
    const user = normalizeWorkOsUser(value);
    return user?.id === workosUserId ? user : null;
  } catch {
    return null;
  }
}

function parseBearerToken(value: string): string | null {
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

function remoteWorkOsJwks(options: WorkOsVerificationOptions): ReturnType<typeof createRemoteJWKSet> {
  const url =
    options.jwksUrl ?? `${workOsBaseUrl(options.apiBaseUrl)}/sso/jwks/${encodeURIComponent(options.clientId)}`;
  const authorization = `Bearer ${options.apiKey}`;
  const cacheKey = `${url}:${authorization}`;
  const cached = remoteJwksCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const remote = createRemoteJWKSet(new URL(url), {
    cacheMaxAge: Infinity,
    headers: { authorization },
  });
  remoteJwksCache.set(cacheKey, remote);
  return remote;
}

function workOsBaseUrl(value: string | undefined): string {
  return (value ?? DEFAULT_WORKOS_API_BASE_URL).replace(/\/+$/, "");
}

function issuerMatches(actual: string | undefined, expected: string): boolean {
  if (!actual) {
    return false;
  }
  return trimTrailingSlash(actual) === trimTrailingSlash(expected);
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function clientIdMatches(payload: JWTPayload, clientId: string, requireClaim: boolean): boolean {
  const clientClaim = stringClaim(payload.client_id) ?? stringClaim(payload.azp);
  if (clientClaim) {
    return clientClaim === clientId;
  }
  if (requireClaim) {
    return false;
  }
  const audience = payload.aud;
  if (typeof audience === "string") {
    return audience === clientId;
  }
  if (Array.isArray(audience)) {
    return audience.includes(clientId);
  }
  return !requireClaim;
}

function stringClaim(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function normalizeWorkOsUser(value: unknown): WorkOsUser | null {
  const raw = unwrapUser(value);
  if (!raw) {
    return null;
  }
  const id = raw.id;
  const email = raw.email;
  return typeof id === "string" && typeof email === "string" ? { id, email } : null;
}

function unwrapUser(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const object = value as Record<string, unknown>;
  if (object.user && typeof object.user === "object" && !Array.isArray(object.user)) {
    return object.user as Record<string, unknown>;
  }
  return object;
}
