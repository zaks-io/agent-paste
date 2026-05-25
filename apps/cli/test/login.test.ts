import { describe, expect, it, vi } from "vitest";
import type { Credential, CredentialStore } from "../src/credentials.js";
import { login } from "../src/login.js";

function memoryStore(): CredentialStore & { saved: Credential | null } {
  const store = {
    saved: null as Credential | null,
    async load() {
      return store.saved;
    },
    async save(credential: Credential) {
      store.saved = credential;
    },
    async delete() {
      store.saved = null;
    },
  };
  return store;
}

function idToken(email: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "none" }), "utf8").toString("base64url");
  const payload = Buffer.from(JSON.stringify({ email }), "utf8").toString("base64url");
  return `${header}.${payload}.`;
}

describe("login flow", () => {
  it("runs loopback PKCE, mints a key, and stores the credential", async () => {
    const store = memoryStore();
    const tokenCalls: Array<Record<string, string>> = [];

    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/oauth2/token")) {
        tokenCalls.push(Object.fromEntries(new URLSearchParams(String(init?.body))));
        return Response.json({ access_token: "wos_access", id_token: idToken("dev@example.com") });
      }
      if (url.endsWith("/v1/web/keys")) {
        return Response.json({
          api_key: {
            id: "key_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
            workspace_id: "22222222-2222-4222-8222-222222222222",
            name: "agent-paste CLI",
            public_id: "0123456789ABCDEF",
            scopes: ["publish", "read"],
            revoked_at: null,
            created_at: "2026-05-24T00:00:00.000Z",
            last_used_at: null,
          },
          secret: "ap_pk_preview_0123456789ABCDEF_abcdefghijklmnopqrstuvwxyz0123456789",
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    const openBrowser = (url: string) => {
      const parsed = new URL(url);
      const redirect = new URL(parsed.searchParams.get("redirect_uri") ?? "");
      const state = parsed.searchParams.get("state") ?? "";
      // Simulate WorkOS redirecting back to the loopback listener. Surface
      // callback failures instead of hanging waitForCallback() until timeout.
      fetch(`${redirect.origin}/callback?code=auth_code&state=${encodeURIComponent(state)}`).catch((err) => {
        console.error("loopback callback failed:", err);
      });
    };

    const credential = await login({
      store,
      fetch: fetchImpl as unknown as typeof fetch,
      openBrowser,
      log: () => {},
      config: {
        clientId: "client_real",
        authorizeUrl: "https://tenant.authkit.app/oauth2/authorize",
        tokenUrl: "https://tenant.authkit.app/oauth2/token",
        apiBaseUrl: "https://api.test",
        loginPort: 0,
      },
    });

    expect(credential).toEqual({
      api_key: "ap_pk_preview_0123456789ABCDEF_abcdefghijklmnopqrstuvwxyz0123456789",
      public_id: "0123456789ABCDEF",
      workspace_id: "22222222-2222-4222-8222-222222222222",
      member_email: "dev@example.com",
    });
    expect(store.saved).toEqual(credential);
    expect(tokenCalls[0]).toMatchObject({
      grant_type: "authorization_code",
      client_id: "client_real",
      code: "auth_code",
      code_verifier: expect.any(String),
    });
    expect(tokenCalls[0]).not.toHaveProperty("client_secret");
  });

  it("aborts when the CLI client is not configured", async () => {
    await expect(
      login({
        config: {
          clientId: "REPLACE_WITH_CLI_PUBLIC_CLIENT_ID",
          authorizeUrl: "https://x/authorize",
          tokenUrl: "https://x/token",
          apiBaseUrl: "https://api.test",
          loginPort: 0,
        },
        log: () => {},
      }),
    ).rejects.toThrow(/not configured/);
  });
});
