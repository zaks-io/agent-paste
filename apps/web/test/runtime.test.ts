import { beforeEach, describe, expect, it, vi } from "vitest";
import { env as cloudflareEnv } from "./mocks/cloudflare-workers";

vi.mock("@tanstack/react-start/server", () => ({
  getRequestHeader: (name: string) => (name === "x-request-id" ? cloudflareEnv._requestId : undefined),
}));

import { getRequestId, getWebEnv } from "../src/server/runtime";

describe("web runtime", () => {
  beforeEach(() => {
    Object.assign(cloudflareEnv, {
      AGENT_PASTE_ENV: "dev",
      API_BASE_URL: "https://api.test",
      WEB_BASE_URL: "https://app.test",
      WORKOS_CLIENT_ID: "client",
      WORKOS_API_KEY: "key",
      WORKOS_REDIRECT_URI: "https://app.test/api/auth/callback",
      WORKOS_COOKIE_PASSWORD: "x".repeat(32),
      _requestId: undefined,
    });
  });

  it("returns validated Cloudflare env bindings", () => {
    expect(getWebEnv()).toMatchObject({
      AGENT_PASTE_ENV: "dev",
      API_BASE_URL: "https://api.test",
      WEB_BASE_URL: "https://app.test",
    });
  });

  it("throws when required env keys are missing or empty", () => {
    cloudflareEnv.API_BASE_URL = "";
    expect(() => getWebEnv()).toThrow(/missing required keys: API_BASE_URL/);
  });

  it("reuses x-request-id when present", () => {
    cloudflareEnv._requestId = "req-existing-12345678";
    expect(getRequestId()).toBe("req-existing-12345678");
  });

  it("generates a UUID when x-request-id is absent", () => {
    expect(getRequestId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });
});
