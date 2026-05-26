import { exportJWK, generateKeyPair, type JWK, SignJWT } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isOperator, verifyCfAccessServiceToken } from "./operator.js";

const teamDomain = "zaks.cloudflareaccess.com";
const aud = "cf-access-aud-id";
let keyPairPromise: ReturnType<typeof generateKeyPair> | undefined;

describe("WorkOS operator role", () => {
  it("matches the single admin role claim", () => {
    expect(isOperator({ workos_user_id: "user_1", email: "user@example.com", role: "admin" })).toBe(true);
  });

  it("matches the multi-role admin claim", () => {
    expect(isOperator({ workos_user_id: "user_1", email: "user@example.com", roles: ["member", "admin"] })).toBe(true);
  });

  it("rejects missing or non-admin roles", () => {
    expect(isOperator({ workos_user_id: "user_1", email: "user@example.com" })).toBe(false);
    expect(isOperator({ workos_user_id: "user_1", email: "user@example.com", role: "member" })).toBe(false);
    expect(isOperator(null)).toBe(false);
  });
});

describe("Cloudflare Access service-token verification", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("accepts a service-token JWT carrying a common_name", async () => {
    const fixture = await tokenFixture({ common_name: "rotation-agent", aud });
    stubAccessFetch(fixture.publicJwk);

    await expect(verifyCfAccessServiceToken(fixture.token, { teamDomain, aud })).resolves.toBe("rotation-agent");
  });

  it("rejects a human Access JWT without a common_name", async () => {
    const fixture = await tokenFixture({ aud });
    stubAccessFetch(fixture.publicJwk);

    await expect(verifyCfAccessServiceToken(fixture.token, { teamDomain, aud })).resolves.toBeNull();
  });

  it("rejects a token whose aud does not match", async () => {
    const fixture = await tokenFixture({ common_name: "rotation-agent", aud: "wrong-aud" });
    stubAccessFetch(fixture.publicJwk);

    await expect(verifyCfAccessServiceToken(fixture.token, { teamDomain, aud })).resolves.toBeNull();
  });

  it("returns null when no assertion header is present", async () => {
    await expect(verifyCfAccessServiceToken(null, { teamDomain, aud })).resolves.toBeNull();
  });
});

async function tokenFixture(input: { common_name?: string; aud: string }) {
  keyPairPromise ??= generateKeyPair("RS256");
  const { publicKey, privateKey } = await keyPairPromise;
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = "access-key";
  publicJwk.alg = "RS256";
  const token = await new SignJWT({ ...(input.common_name ? { common_name: input.common_name } : {}) })
    .setProtectedHeader({ alg: "RS256", kid: "access-key" })
    .setIssuer(`https://${teamDomain}`)
    .setAudience(input.aud)
    .setSubject("svc")
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + 300)
    .sign(privateKey);
  return { token, publicJwk };
}

function stubAccessFetch(publicJwk: JWK) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL | Request) => {
      const href = url instanceof Request ? url.url : String(url);
      if (href === `https://${teamDomain}/cdn-cgi/access/certs`) {
        return Response.json({ keys: [publicJwk] });
      }
      return new Response("not found", { status: 404 });
    }),
  );
}
