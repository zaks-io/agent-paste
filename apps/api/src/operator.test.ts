import { exportJWK, generateKeyPair, type JWK, SignJWT } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getOperatorEmails, isOperator, verifyCfAccessServiceToken } from "./operator.js";

const teamDomain = "zaks.cloudflareaccess.com";
const aud = "cf-access-aud-id";
let keyPairPromise: ReturnType<typeof generateKeyPair> | undefined;

describe("operator email allow-list", () => {
  it("parses, trims, and case-folds OPERATOR_EMAILS", () => {
    expect(getOperatorEmails(" Ops@Example.com , second@example.com ,, ")).toEqual([
      "ops@example.com",
      "second@example.com",
    ]);
  });

  it("treats missing OPERATOR_EMAILS as an empty list", () => {
    expect(getOperatorEmails(undefined)).toEqual([]);
    expect(isOperator(undefined, "ops@example.com")).toBe(false);
  });

  it("matches operator emails case-insensitively", () => {
    expect(isOperator("ops@example.com", "OPS@EXAMPLE.COM")).toBe(true);
    expect(isOperator("ops@example.com", "other@example.com")).toBe(false);
    expect(isOperator("ops@example.com", null)).toBe(false);
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
