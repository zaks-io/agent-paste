import { exportJWK, generateKeyPair, type JWK, SignJWT } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveWorkOsIdentity } from "./workos.js";

const clientId = "client_01J5K7Y8G9H0ABCDEFGHJKMNPQ";
const apiKey = "sk_test_123";
const issuer = "https://api.workos.com";
const subject = "user_01J5K7Y8G9H0ABCDEFGHJKMNPQ";
const sessionId = "session_01J5K7Y8G9H0ABCDEFGHJKMNPQ";
const tokenId = "test-token-id";
let keyPairPromise: ReturnType<typeof generateKeyPair> | undefined;

describe("WorkOS access-token verification", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("accepts a valid WorkOS JWT and fetches the canonical user record", async () => {
    const fixture = await tokenFixture({ client_id: clientId });
    stubWorkOsFetch(fixture.publicJwk);

    await expect(resolveWorkOsIdentity(`Bearer ${fixture.token}`, options())).resolves.toEqual({
      workos_user_id: subject,
      email: "user@example.com",
      session_id: sessionId,
      token_id: tokenId,
    });
  });

  it("accepts a claim-less session token when client-id claims are not required", async () => {
    const fixture = await tokenFixture({});
    stubWorkOsFetch(fixture.publicJwk);

    await expect(
      resolveWorkOsIdentity(`Bearer ${fixture.token}`, options({ requireClientIdClaim: false })),
    ).resolves.toEqual({
      workos_user_id: subject,
      email: "user@example.com",
      session_id: sessionId,
      token_id: tokenId,
    });
  });

  it("accepts a token whose issuer is one of several allowed issuers", async () => {
    const authkitIssuer = "https://soulful-path-50.authkit.app";
    const fixture = await tokenFixture({ iss: authkitIssuer });
    stubWorkOsFetch(fixture.publicJwk);

    await expect(
      resolveWorkOsIdentity(
        `Bearer ${fixture.token}`,
        options({ requireClientIdClaim: false, issuers: [issuer, authkitIssuer] }),
      ),
    ).resolves.toMatchObject({ workos_user_id: subject, email: "user@example.com" });
  });

  it("rejects a JWT with the wrong client_id claim", async () => {
    const fixture = await tokenFixture({ client_id: "client_wrong" });
    stubWorkOsFetch(fixture.publicJwk);

    await expect(resolveWorkOsIdentity(`Bearer ${fixture.token}`, options())).resolves.toBeNull();
  });

  it("rejects an aud-only JWT when strict client claims are required", async () => {
    const fixture = await tokenFixture({ aud: clientId });
    stubWorkOsFetch(fixture.publicJwk);

    await expect(resolveWorkOsIdentity(`Bearer ${fixture.token}`, options())).resolves.toBeNull();
  });

  it("rejects a JWT with the wrong issuer", async () => {
    const fixture = await tokenFixture({ client_id: clientId, iss: "https://evil.example" });
    stubWorkOsFetch(fixture.publicJwk);

    await expect(resolveWorkOsIdentity(`Bearer ${fixture.token}`, options())).resolves.toBeNull();
  });

  it("rejects an expired JWT", async () => {
    const fixture = await tokenFixture({ client_id: clientId, expiresAt: Math.floor(Date.now() / 1000) - 60 });
    stubWorkOsFetch(fixture.publicJwk);

    await expect(resolveWorkOsIdentity(`Bearer ${fixture.token}`, options())).resolves.toBeNull();
  });

  it("rejects a JWT without a token id or session id", async () => {
    const fixture = await tokenFixture({ client_id: clientId, sessionId: null, tokenId: null });
    stubWorkOsFetch(fixture.publicJwk);

    await expect(resolveWorkOsIdentity(`Bearer ${fixture.token}`, options())).resolves.toBeNull();
  });

  it("rejects a malformed bearer header before calling WorkOS", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    await expect(resolveWorkOsIdentity("not-a-bearer-token", options())).resolves.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns null when the WorkOS user response cannot be parsed", async () => {
    const fixture = await tokenFixture({ client_id: clientId });
    stubWorkOsFetch(fixture.publicJwk, {
      userResponse: new Response("not-json", {
        headers: { "content-type": "application/json" },
      }),
    });

    await expect(resolveWorkOsIdentity(`Bearer ${fixture.token}`, options())).resolves.toBeNull();
  });
});

function options(overrides: Partial<ReturnType<typeof baseOptions>> = {}) {
  return { ...baseOptions(), ...overrides };
}

function baseOptions() {
  return {
    apiKey,
    clientId,
    apiBaseUrl: "https://workos.test",
    issuers: [issuer],
    requireClientIdClaim: true,
  };
}

async function tokenFixture(input: {
  client_id?: string;
  iss?: string;
  expiresAt?: number;
  aud?: string;
  sessionId?: string | null;
  tokenId?: string | null;
}) {
  keyPairPromise ??= generateKeyPair("RS256");
  const { publicKey, privateKey } = await keyPairPromise;
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = "test-key";
  publicJwk.alg = "RS256";
  const expiresAt = input.expiresAt ?? Math.floor(Date.now() / 1000) + 300;
  const jwt = new SignJWT({
    ...(input.client_id ? { client_id: input.client_id } : {}),
    ...(input.sessionId !== null ? { sid: input.sessionId ?? sessionId } : {}),
  })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(input.iss ?? issuer)
    .setSubject(subject)
    .setIssuedAt()
    .setExpirationTime(expiresAt);
  if (input.tokenId !== null) {
    jwt.setJti(input.tokenId ?? tokenId);
  }
  if (input.aud) {
    jwt.setAudience(input.aud);
  }
  const token = await jwt.sign(privateKey);
  return { token, publicJwk };
}

function stubWorkOsFetch(publicJwk: JWK, options: { userResponse?: Response } = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL | Request) => {
      const href = url instanceof Request ? url.url : String(url);
      if (href.endsWith(`/sso/jwks/${clientId}`)) {
        return Response.json({ keys: [publicJwk] });
      }
      if (href.endsWith(`/user_management/users/${subject}`)) {
        return options.userResponse ?? Response.json({ id: subject, email: "user@example.com" });
      }
      return new Response("not found", { status: 404 });
    }),
  );
}
