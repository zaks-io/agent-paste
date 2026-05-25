import { exportJWK, generateKeyPair, type JWK, SignJWT } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import { authenticateWebIdentity, type Env } from "./index.js";

const dashboardClientId = "client_dashboard";
// The environment OIDC client stamped into a Connect token's `aud`.
const cliAudience = "client_env_audience";
const subject = "user_01J5K7Y8G9H0ABCDEFGHJKMNPQ";
const apiBaseUrl = "https://workos.test";
const cliJwksUrl = "https://tenant.authkit.app/oauth2/jwks";
const cliIssuer = "https://tenant.authkit.app";
let keyPairPromise: ReturnType<typeof generateKeyPair> | undefined;

function baseEnv(overrides: Partial<Env> = {}): Env {
  return {
    WORKOS_API_KEY: "sk_test_123",
    WORKOS_CLIENT_ID: dashboardClientId,
    WORKOS_API_BASE_URL: apiBaseUrl,
    WORKOS_CLI_AUDIENCE: cliAudience,
    WORKOS_CLI_JWKS_URL: cliJwksUrl,
    WORKOS_CLI_ISSUER: cliIssuer,
    ...overrides,
  };
}

function request(token: string): Request {
  return new Request("https://api.test/v1/web/keys", { headers: { authorization: `Bearer ${token}` } });
}

describe("CLI Connect token isolation on the key-mint path", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("accepts a CLI-client token on the key-mint route", async () => {
    const fixture = await cliTokenFixture();
    stubFetch(fixture.publicJwk);

    const identity = await authenticateWebIdentity(request(fixture.token), baseEnv(), { allowCliClient: true });
    expect(identity).toEqual({ workos_user_id: subject, email: "user@example.com", session_id: "sid_cli" });
  });

  it("rejects a CLI-client token on non-mint routes (allowCliClient false)", async () => {
    const fixture = await cliTokenFixture();
    stubFetch(fixture.publicJwk);

    const identity = await authenticateWebIdentity(request(fixture.token), baseEnv(), { allowCliClient: false });
    expect(identity).toBeNull();
  });

  it("rejects a CLI-client token on key-mint when WORKOS_CLI_AUDIENCE is unset", async () => {
    const fixture = await cliTokenFixture();
    stubFetch(fixture.publicJwk);

    const env = baseEnv({ WORKOS_CLI_AUDIENCE: undefined, WORKOS_CLI_JWKS_URL: undefined });
    const identity = await authenticateWebIdentity(request(fixture.token), env, { allowCliClient: true });
    expect(identity).toBeNull();
  });
});

async function cliTokenFixture() {
  keyPairPromise ??= generateKeyPair("RS256");
  const { publicKey, privateKey } = await keyPairPromise;
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = "cli-key";
  publicJwk.alg = "RS256";
  // Mirror a real WorkOS Connect access token: `aud` is the environment OIDC
  // client, with no `client_id`/`azp` claim (unlike AuthKit dashboard tokens).
  const token = await new SignJWT({ sid: "sid_cli" })
    .setProtectedHeader({ alg: "RS256", kid: "cli-key" })
    .setIssuer(cliIssuer)
    .setAudience(cliAudience)
    .setSubject(subject)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + 300)
    .sign(privateKey);
  return { token, publicJwk };
}

function stubFetch(publicJwk: JWK) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL | Request) => {
      const href = url instanceof Request ? url.url : String(url);
      if (href === cliJwksUrl || href.endsWith(`/sso/jwks/${dashboardClientId}`)) {
        return Response.json({ keys: [publicJwk] });
      }
      if (href.endsWith(`/user_management/users/${subject}`)) {
        return Response.json({ id: subject, email: "user@example.com" });
      }
      return new Response("not found", { status: 404 });
    }),
  );
}
