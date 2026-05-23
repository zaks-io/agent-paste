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

function options() {
  return {
    apiKey,
    clientId,
    apiBaseUrl: "https://workos.test",
    issuer,
    requireClientIdClaim: true,
  };
}

async function tokenFixture(input: { client_id?: string; iss?: string; expiresAt?: number; aud?: string }) {
  keyPairPromise ??= generateKeyPair("RS256");
  const { publicKey, privateKey } = await keyPairPromise;
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = "test-key";
  publicJwk.alg = "RS256";
  const expiresAt = input.expiresAt ?? Math.floor(Date.now() / 1000) + 300;
  const jwt = new SignJWT({ ...(input.client_id ? { client_id: input.client_id } : {}), sid: sessionId })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(input.iss ?? issuer)
    .setSubject(subject)
    .setJti(tokenId)
    .setIssuedAt()
    .setExpirationTime(expiresAt);
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
