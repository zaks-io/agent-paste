import { describe, expect, it } from "vitest";
import { isPlaceholderClientId, loadLoginConfig } from "../src/config.js";

describe("login config", () => {
  it("defaults the authorize and token paths off the baked authkit base url", () => {
    const config = loadLoginConfig({ AGENT_PASTE_WORKOS_CLIENT_ID: "client_abc" });
    expect(config.clientId).toBe("client_abc");
    expect(config.authorizeUrl).toBe("https://courageous-milestone-75-staging.authkit.app/oauth2/authorize");
    expect(config.tokenUrl).toBe("https://courageous-milestone-75-staging.authkit.app/oauth2/token");
  });

  it("ships a real default client id (no env required)", () => {
    expect(loadLoginConfig({}).clientId).toBe("client_01KSE8K12YEJ6TEDAM2X0R8VRA");
  });

  it("derives endpoints from a custom authkit base url", () => {
    const config = loadLoginConfig({
      AGENT_PASTE_WORKOS_CLIENT_ID: "client_abc",
      AGENT_PASTE_WORKOS_BASE_URL: "https://tenant.authkit.app/",
    });
    expect(config.authorizeUrl).toBe("https://tenant.authkit.app/oauth2/authorize");
    expect(config.tokenUrl).toBe("https://tenant.authkit.app/oauth2/token");
  });

  it("honors explicit endpoint overrides and api url", () => {
    const config = loadLoginConfig({
      AGENT_PASTE_WORKOS_CLIENT_ID: "client_abc",
      AGENT_PASTE_WORKOS_AUTHORIZE_URL: "https://a.example/authorize",
      AGENT_PASTE_WORKOS_TOKEN_URL: "https://a.example/token",
      AGENT_PASTE_API_URL: "https://api.preview.agent-paste.sh/",
    });
    expect(config.authorizeUrl).toBe("https://a.example/authorize");
    expect(config.tokenUrl).toBe("https://a.example/token");
    expect(config.apiBaseUrl).toBe("https://api.preview.agent-paste.sh");
  });

  it("defaults the loopback port and honors AGENT_PASTE_LOGIN_PORT", () => {
    expect(loadLoginConfig({}).loginPort).toBe(8975);
    expect(loadLoginConfig({ AGENT_PASTE_LOGIN_PORT: "9090" }).loginPort).toBe(9090);
    expect(loadLoginConfig({ AGENT_PASTE_LOGIN_PORT: "0" }).loginPort).toBe(0);
  });

  it("ignores an out-of-range or non-numeric login port and falls back to the default", () => {
    expect(loadLoginConfig({ AGENT_PASTE_LOGIN_PORT: "70000" }).loginPort).toBe(8975);
    expect(loadLoginConfig({ AGENT_PASTE_LOGIN_PORT: "not-a-port" }).loginPort).toBe(8975);
    expect(loadLoginConfig({ AGENT_PASTE_LOGIN_PORT: "" }).loginPort).toBe(8975);
    expect(loadLoginConfig({ AGENT_PASTE_LOGIN_PORT: "   " }).loginPort).toBe(8975);
  });

  it("flags empty and sentinel client ids as unconfigured, but not the real default", () => {
    expect(isPlaceholderClientId("")).toBe(true);
    expect(isPlaceholderClientId("REPLACE_WITH_CLI_PUBLIC_CLIENT_ID")).toBe(true);
    expect(isPlaceholderClientId(loadLoginConfig({}).clientId)).toBe(false);
    expect(isPlaceholderClientId("client_real")).toBe(false);
  });
});
