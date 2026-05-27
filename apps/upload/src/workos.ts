import { createRemoteJWKSet, type JWTPayload, jwtVerify } from "jose";

export type WorkOsIdentity = {
  workos_user_id: string;
  email: string;
  auth_surface?: "dashboard" | "cli" | "mcp";
};

export type WorkOsRejectReason =
  | "no_bearer"
  | "verify_threw"
  | "missing_sub"
  | "bad_exp"
  | "issuer_mismatch"
  | "client_id_mismatch"
  | "user_fetch_failed"
  | "user_id_mismatch";

export type WorkOsVerificationOptions = {
  apiKey: string;
  clientId: string;
  apiBaseUrl?: string;
  issuers?: string[];
  jwksUrl?: string;
  requireClientIdClaim?: boolean;
  skipClientIdClaimVerification?: boolean;
  onReject?: (reason: WorkOsRejectReason, detail?: Record<string, unknown>) => void;
};

type WorkOsUser = {
  id: string;
  email: string;
};

const DEFAULT_WORKOS_API_BASE_URL = "https://api.workos.com";
const DEFAULT_WORKOS_ISSUER = "https://api.workos.com";
const WORKOS_JWKS_CACHE_MAX_AGE_MS = 60 * 60 * 1000;
const remoteJwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export async function verifyWorkOsAccessToken(
  token: string,
  options: WorkOsVerificationOptions,
): Promise<{ sub: string; payload: JWTPayload; sessionId?: string; tokenId?: string } | null> {
  try {
    const jwks = remoteWorkOsJwks(options);
    const { payload } = await jwtVerify(token, jwks, { algorithms: ["RS256"] });
    if (!payload.sub) {
      options.onReject?.("missing_sub");
      return null;
    }
    if (typeof payload.exp !== "number") {
      options.onReject?.("bad_exp");
      return null;
    }
    if (!issuerMatches(payload.iss, options.issuers)) {
      options.onReject?.("issuer_mismatch", { iss: payload.iss ?? null });
      return null;
    }
    if (
      !options.skipClientIdClaimVerification &&
      !clientIdMatches(payload, options.clientId, options.requireClientIdClaim === true)
    ) {
      options.onReject?.("client_id_mismatch");
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
  } catch (error) {
    options.onReject?.("verify_threw", { error: errorLabel(error) });
    return null;
  }
}

export async function fetchWorkOsUser(
  workosUserId: string,
  options: Pick<WorkOsVerificationOptions, "apiBaseUrl" | "apiKey" | "onReject">,
): Promise<WorkOsUser | null> {
  try {
    const response = await fetch(
      `${workOsBaseUrl(options.apiBaseUrl)}/user_management/users/${encodeURIComponent(workosUserId)}`,
      {
        headers: { authorization: `Bearer ${options.apiKey}` },
      },
    );
    if (!response.ok) {
      options.onReject?.("user_fetch_failed", { status: response.status });
      return null;
    }
    const value = await response.json();
    const user = normalizeWorkOsUser(value);
    if (!user || user.id !== workosUserId) {
      options.onReject?.("user_id_mismatch");
      return null;
    }
    return user;
  } catch (error) {
    options.onReject?.("user_fetch_failed", { error: errorLabel(error) });
    return null;
  }
}

function errorLabel(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? `${code}: ${error.message}` : `${error.name}: ${error.message}`;
  }
  return String(error);
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
    cacheMaxAge: WORKOS_JWKS_CACHE_MAX_AGE_MS,
    headers: { authorization },
  });
  remoteJwksCache.set(cacheKey, remote);
  return remote;
}

function workOsBaseUrl(value: string | undefined): string {
  return (value ?? DEFAULT_WORKOS_API_BASE_URL).replace(/\/+$/, "");
}

function issuerMatches(actual: string | undefined, expected: readonly string[] | undefined): boolean {
  if (!actual) {
    return false;
  }
  const allowed = expected && expected.length > 0 ? expected : [DEFAULT_WORKOS_ISSUER];
  const normalized = actual.replace(/\/+$/, "");
  return allowed.some((issuer) => issuer.replace(/\/+$/, "") === normalized);
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
  const raw =
    value && typeof value === "object" && "user" in value && typeof (value as { user: unknown }).user === "object"
      ? ((value as { user: Record<string, unknown> }).user as Record<string, unknown>)
      : (value as Record<string, unknown> | null);
  if (!raw) {
    return null;
  }
  const id = raw.id;
  const email = raw.email;
  return typeof id === "string" && typeof email === "string" ? { id, email } : null;
}
