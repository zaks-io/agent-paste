import { describe, expect, it, vi } from "vitest";
import { mintForPrefix, mintWorkOsM2MToken, resolveM2MCredentials } from "./workos-m2m.mjs";

const PREFIX = "AGENT_PASTE_MCP_SMOKE";

function env(overrides = {}) {
  return {
    [`${PREFIX}_WORKOS_M2M_CLIENT_ID`]: "client_x",
    [`${PREFIX}_WORKOS_M2M_CLIENT_SECRET`]: "secret_x",
    [`${PREFIX}_WORKOS_M2M_TOKEN_URL`]: "https://x.authkit.app/oauth2/token",
    ...overrides,
  };
}

describe("workos-m2m", () => {
  it("resolves credentials when all three required vars are present", () => {
    expect(resolveM2MCredentials(PREFIX, env())).toEqual({
      tokenUrl: "https://x.authkit.app/oauth2/token",
      clientId: "client_x",
      clientSecret: "secret_x",
      scope: undefined,
    });
  });

  it("returns null when any required var is missing", () => {
    expect(resolveM2MCredentials(PREFIX, env({ [`${PREFIX}_WORKOS_M2M_CLIENT_SECRET`]: undefined }))).toBeNull();
    expect(resolveM2MCredentials(PREFIX, {})).toBeNull();
  });

  it("includes optional scope when set", () => {
    const creds = resolveM2MCredentials(PREFIX, env({ [`${PREFIX}_WORKOS_M2M_SCOPE`]: "write read" }));
    expect(creds.scope).toBe("write read");
  });

  it("posts client_credentials and returns the access token", async () => {
    const fetchImpl = vi.fn(async (url, init) => {
      expect(url).toBe("https://x.authkit.app/oauth2/token");
      expect(init.method).toBe("POST");
      const body = init.body.toString();
      expect(body).toContain("grant_type=client_credentials");
      expect(body).toContain("client_id=client_x");
      expect(body).toContain("client_secret=secret_x");
      return { ok: true, json: async () => ({ access_token: "tok_123" }) };
    });
    await expect(
      mintWorkOsM2MToken(
        { tokenUrl: "https://x.authkit.app/oauth2/token", clientId: "client_x", clientSecret: "secret_x" },
        fetchImpl,
      ),
    ).resolves.toBe("tok_123");
  });

  it("throws with detail on a non-ok response", async () => {
    const fetchImpl = async () => ({ ok: false, status: 401, text: async () => "bad client" });
    await expect(mintWorkOsM2MToken({ tokenUrl: "u", clientId: "c", clientSecret: "s" }, fetchImpl)).rejects.toThrow(
      /401.*bad client/,
    );
  });

  it("throws when the response lacks an access_token", async () => {
    const fetchImpl = async () => ({ ok: true, json: async () => ({}) });
    await expect(mintWorkOsM2MToken({ tokenUrl: "u", clientId: "c", clientSecret: "s" }, fetchImpl)).rejects.toThrow(
      /no access_token/,
    );
  });

  it("mintForPrefix returns a skip reason when unconfigured", async () => {
    const result = await mintForPrefix(PREFIX, { source: {} });
    expect(result.token).toBeNull();
    expect(result.reason).toContain("_WORKOS_M2M_CLIENT_ID");
  });

  it("mintForPrefix mints when configured", async () => {
    const fetchImpl = async () => ({ ok: true, json: async () => ({ access_token: "tok_abc" }) });
    const result = await mintForPrefix(PREFIX, { source: env(), fetchImpl });
    expect(result.token).toBe("tok_abc");
  });
});
