// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: Record<string, unknown>) => config,
}));

const handleCallback = vi.fn();
const clearPendingVerifier = vi.fn();

vi.mock("@workos/authkit-session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workos/authkit-session")>();
  return {
    ...actual,
    createAuthService: () => ({
      handleCallback,
      clearPendingVerifier,
    }),
  };
});

describe("auth callback route", () => {
  beforeEach(() => {
    handleCallback.mockReset();
    clearPendingVerifier.mockReset();
    clearPendingVerifier.mockResolvedValue({ response: new Response(), headers: {} });
    handleCallback.mockResolvedValue({
      returnPathname: "/billing",
      authResponse: {
        accessToken: "access_token",
        refreshToken: "refresh_token",
        user: { id: "user_01", email: "user@example.com" },
      },
      state: "oauth_state",
      response: new Response(),
    });
  });

  it("redirects to the OAuth returnPathname instead of forcing /dashboard", async () => {
    const callback = await import("../src/routes/api/auth/callback");
    const response = await callback.Route.server.handlers.GET({
      request: new Request("https://app.agent-paste.sh/api/auth/callback?code=oauth_code&state=oauth_state"),
    });

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://app.agent-paste.sh/billing");
    expect(response.headers.get("location")).not.toContain("/dashboard");
  });
});
