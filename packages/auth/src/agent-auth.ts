import { createRemoteJWKSet, decodeJwt, decodeProtectedHeader, type JWTPayload, jwtVerify, SignJWT } from "jose";

export type AgentAuthTrustedProvider = {
  issuer: string;
  displayName: string;
  jwksUri?: string;
  clientIds: string[];
  algorithms?: string[];
};

export type VerifiedAgentProviderIdentity = {
  issuer: string;
  subject: string;
  audience: string;
  clientId: string;
  email: string;
  jti: string;
  expiresAt: string;
  providerDisplayName: string;
};

export type VerifiedAgentSecurityEvent = {
  issuer: string;
  subject: string;
  audience: string;
  jti: string;
  expiresAt: string;
  eventTypes: string[];
};

export type AgentAuthVerificationCode =
  | "invalid_request"
  | "invalid_issuer"
  | "invalid_signature"
  | "expired"
  | "replay_detected"
  | "invalid_audience"
  | "invalid_client_id"
  | "missing_verified_email"
  | "login_required";

export type AgentAuthVerificationOptions = {
  audience: string;
  trustedProviders: AgentAuthTrustedProvider[];
  assertionType?: "oauth-id-jag+jwt" | "secevent+jwt";
  maxAuthAgeSeconds?: number;
  clockSkewSeconds?: number;
  now?: Date;
};

export type AgentAuthServiceAssertionPayload = {
  registration_id: string;
  registration_type: "identity_assertion" | "anonymous";
  anonymous_claim_state?: "pre_claim" | "post_claim";
  scopes: string[];
  issued_at: string;
  exp: number;
};

const DEFAULT_MAX_AUTH_AGE_SECONDS = 60 * 60;
const DEFAULT_CLOCK_SKEW_SECONDS = 120;
const providerJwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export class AgentAuthVerificationError extends Error {
  readonly name = "AgentAuthVerificationError";
  readonly code: AgentAuthVerificationCode;
  readonly maxAge?: number;

  constructor(code: AgentAuthVerificationCode, message = code, options: { maxAge?: number } = {}) {
    super(message);
    this.code = code;
    if (options.maxAge !== undefined) {
      this.maxAge = options.maxAge;
    }
  }
}

export function parseAgentAuthTrustedProviders(raw: string | undefined): AgentAuthTrustedProvider[] {
  if (!raw?.trim()) {
    return [];
  }
  const value = JSON.parse(raw) as unknown;
  if (!Array.isArray(value)) {
    throw new Error("agent_auth_trusted_providers_must_be_array");
  }
  return value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("agent_auth_trusted_provider_must_be_object");
    }
    const provider = entry as Record<string, unknown>;
    const issuer = stringValue(provider.issuer);
    const displayName = stringValue(provider.display_name) ?? stringValue(provider.displayName);
    const clientIds = stringArray(provider.client_ids ?? provider.clientIds);
    if (!issuer || !displayName || clientIds.length === 0) {
      throw new Error("agent_auth_trusted_provider_missing_required_fields");
    }
    const jwksUri = stringValue(provider.jwks_uri) ?? stringValue(provider.jwksUri);
    assertHttpsUrl(issuer, "agent_auth_trusted_provider_invalid_issuer_url");
    if (jwksUri) {
      assertHttpsUrl(jwksUri, "agent_auth_trusted_provider_invalid_jwks_uri");
    }
    const algorithms = stringArray(provider.algorithms);
    return {
      issuer: normalizeIssuer(issuer),
      displayName,
      clientIds,
      ...(jwksUri ? { jwksUri } : {}),
      ...(algorithms.length > 0 ? { algorithms } : {}),
    };
  });
}

export async function verifyAgentProviderIdentityAssertion(
  assertion: string,
  options: AgentAuthVerificationOptions,
): Promise<VerifiedAgentProviderIdentity> {
  const verified = await verifyTrustedProviderJwt(assertion, { ...options, assertionType: "oauth-id-jag+jwt" });
  const nowSeconds = nowSecondsFromDate(options.now);
  const maxAge = options.maxAuthAgeSeconds ?? DEFAULT_MAX_AUTH_AGE_SECONDS;
  const clockSkew = options.clockSkewSeconds ?? DEFAULT_CLOCK_SKEW_SECONDS;
  const { payload, provider } = verified;

  const subject = stringValue(payload.sub);
  const clientId = stringValue(payload.client_id);
  const jti = stringValue(payload.jti);
  const iat = numberValue(payload.iat);
  const exp = numberValue(payload.exp);
  const authTime = numberValue(payload.auth_time);
  const email = stringValue(payload.email)?.toLowerCase();
  const emailVerified = payload.email_verified === true;

  if (!subject || !clientId || !jti || iat === null || exp === null || authTime === null) {
    throw new AgentAuthVerificationError("invalid_request");
  }
  if (iat > nowSeconds + clockSkew || authTime > nowSeconds + clockSkew) {
    throw new AgentAuthVerificationError("invalid_request");
  }
  if (nowSeconds - authTime > maxAge) {
    throw new AgentAuthVerificationError("login_required", "login_required", { maxAge });
  }
  if (!provider.clientIds.includes(clientId)) {
    throw new AgentAuthVerificationError("invalid_client_id");
  }
  if (!email || !emailVerified) {
    throw new AgentAuthVerificationError("missing_verified_email");
  }

  return {
    issuer: provider.issuer,
    subject,
    audience: options.audience,
    clientId,
    email,
    jti,
    expiresAt: new Date(exp * 1000).toISOString(),
    providerDisplayName: provider.displayName,
  };
}

export async function verifyAgentProviderSecurityEvent(
  assertion: string,
  options: AgentAuthVerificationOptions,
): Promise<VerifiedAgentSecurityEvent> {
  const verified = await verifyTrustedProviderJwt(assertion, { ...options, assertionType: "secevent+jwt" });
  const subject = stringValue(verified.payload.sub);
  const jti = stringValue(verified.payload.jti);
  const exp = numberValue(verified.payload.exp);
  const events = verified.payload.events;
  if (!subject || !jti || exp === null || !events || typeof events !== "object" || Array.isArray(events)) {
    throw new AgentAuthVerificationError("invalid_request");
  }
  return {
    issuer: verified.provider.issuer,
    subject,
    audience: options.audience,
    jti,
    expiresAt: new Date(exp * 1000).toISOString(),
    eventTypes: Object.keys(events),
  };
}

export async function mintAgentAuthServiceAssertion(input: {
  issuer: string;
  secret: string;
  registrationId: string;
  registrationType?: AgentAuthServiceAssertionPayload["registration_type"];
  anonymousClaimState?: NonNullable<AgentAuthServiceAssertionPayload["anonymous_claim_state"]>;
  scopes: string[];
  expiresAt: Date;
  now?: Date;
}): Promise<string> {
  const nowSeconds = nowSecondsFromDate(input.now);
  const exp = Math.floor(input.expiresAt.getTime() / 1000);
  const registrationType = input.registrationType ?? "identity_assertion";
  return new SignJWT({
    registration_type: registrationType,
    ...(registrationType === "anonymous" ? { anonymous_claim_state: input.anonymousClaimState ?? "pre_claim" } : {}),
    scopes: input.scopes,
  })
    .setProtectedHeader({ alg: "HS256", typ: "oauth-id-jag+jwt" })
    .setIssuer(input.issuer)
    .setAudience(input.issuer)
    .setSubject(input.registrationId)
    .setJti(crypto.randomUUID())
    .setIssuedAt(nowSeconds)
    .setExpirationTime(exp)
    .sign(secretKey(input.secret));
}

export async function verifyAgentAuthServiceAssertion(input: {
  assertion: string;
  issuer: string;
  secret: string;
  now?: Date;
}): Promise<AgentAuthServiceAssertionPayload | null> {
  try {
    const header = decodeProtectedHeader(input.assertion);
    if (header.typ !== "oauth-id-jag+jwt") {
      return null;
    }
    const { payload } = await jwtVerify(input.assertion, secretKey(input.secret), {
      algorithms: ["HS256"],
      issuer: input.issuer,
      audience: input.issuer,
      ...(input.now ? { currentDate: input.now } : {}),
    });
    const registrationId = stringValue(payload.sub);
    const registrationType = stringValue(payload.registration_type);
    const anonymousClaimState = stringValue(payload.anonymous_claim_state);
    const parsedAnonymousClaimState =
      registrationType === "anonymous" && isAnonymousClaimState(anonymousClaimState) ? anonymousClaimState : null;
    const scopes = stringArray(payload.scopes);
    const iat = numberValue(payload.iat);
    const exp = numberValue(payload.exp);
    if (
      !registrationId ||
      (registrationType !== "identity_assertion" && registrationType !== "anonymous") ||
      iat === null ||
      exp === null
    ) {
      return null;
    }
    if (registrationType === "anonymous" && !parsedAnonymousClaimState) {
      return null;
    }
    return {
      registration_id: registrationId,
      registration_type: registrationType,
      ...(parsedAnonymousClaimState ? { anonymous_claim_state: parsedAnonymousClaimState } : {}),
      scopes,
      issued_at: new Date(iat * 1000).toISOString(),
      exp,
    };
  } catch {
    return null;
  }
}

async function verifyTrustedProviderJwt(
  assertion: string,
  options: AgentAuthVerificationOptions & { assertionType: "oauth-id-jag+jwt" | "secevent+jwt" },
): Promise<{ payload: JWTPayload; provider: AgentAuthTrustedProvider }> {
  let header: ReturnType<typeof decodeProtectedHeader>;
  let unverified: JWTPayload;
  try {
    header = decodeProtectedHeader(assertion);
    unverified = decodeJwt(assertion);
  } catch {
    throw new AgentAuthVerificationError("invalid_request");
  }
  if (header.typ !== options.assertionType) {
    throw new AgentAuthVerificationError("invalid_request");
  }
  const issuer = stringValue(unverified.iss);
  const provider = issuer ? findTrustedProvider(options.trustedProviders, issuer) : null;
  if (!provider) {
    throw new AgentAuthVerificationError("invalid_issuer");
  }

  const jwks = remoteJwks(provider);
  try {
    const { payload } = await jwtVerify(assertion, jwks, {
      algorithms: provider.algorithms ?? ["RS256"],
      audience: options.audience,
      issuer: provider.issuer,
      clockTolerance: options.clockSkewSeconds ?? DEFAULT_CLOCK_SKEW_SECONDS,
      ...(options.now ? { currentDate: options.now } : {}),
    });
    return { payload, provider };
  } catch (error) {
    if (error instanceof Error && (error as { code?: unknown }).code === "ERR_JWT_EXPIRED") {
      throw new AgentAuthVerificationError("expired");
    }
    const payloadAudience = unverified.aud;
    if (!audienceMatches(payloadAudience, options.audience)) {
      throw new AgentAuthVerificationError("invalid_audience");
    }
    throw new AgentAuthVerificationError("invalid_signature");
  }
}

function remoteJwks(provider: AgentAuthTrustedProvider): ReturnType<typeof createRemoteJWKSet> {
  const uri = provider.jwksUri ?? `${provider.issuer}/.well-known/jwks.json`;
  const cached = providerJwksCache.get(uri);
  if (cached) {
    return cached;
  }
  const jwks = createRemoteJWKSet(new URL(uri));
  providerJwksCache.set(uri, jwks);
  return jwks;
}

function findTrustedProvider(providers: AgentAuthTrustedProvider[], issuer: string): AgentAuthTrustedProvider | null {
  const normalized = normalizeIssuer(issuer);
  return providers.find((provider) => provider.issuer === normalized) ?? null;
}

function normalizeIssuer(issuer: string): string {
  return issuer.replace(/\/+$/, "");
}

function assertHttpsUrl(value: string, errorCode: string) {
  try {
    if (new URL(value).protocol !== "https:") {
      throw new Error(errorCode);
    }
  } catch {
    throw new Error(errorCode);
  }
}

function audienceMatches(value: JWTPayload["aud"], expected: string): boolean {
  return Array.isArray(value) ? value.includes(expected) : value === expected;
}

function secretKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

function nowSecondsFromDate(value: Date | undefined): number {
  return Math.floor((value ?? new Date()).getTime() / 1000);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isAnonymousClaimState(
  value: unknown,
): value is NonNullable<AgentAuthServiceAssertionPayload["anonymous_claim_state"]> {
  return value === "pre_claim" || value === "post_claim";
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
    : [];
}
