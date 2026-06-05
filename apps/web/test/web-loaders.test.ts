import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  auth: {
    user: { email: "user@example.com" },
    accessToken: "access-token",
    role: undefined as string | undefined,
    roles: undefined as string[] | undefined,
  } as {
    user: { email: string } | null;
    accessToken?: string;
    role?: string;
    roles?: string[];
  },
  apiFetchOrEmpty: vi.fn(),
  turnstileSiteKey: vi.fn(() => "turnstile-site-key"),
}));

vi.mock("@tanstack/react-start", () => ({
  getGlobalStartContext: () => ({
    auth: () =>
      state.auth.user
        ? {
            ...state.auth,
            sessionId: "session_1",
            claims: {
              role: state.auth.role,
              roles: state.auth.roles,
            },
          }
        : { user: null },
  }),
}));

vi.mock("../src/server/api-client", () => ({
  apiFetchOrEmpty: (...args: unknown[]) => state.apiFetchOrEmpty(...args),
}));

vi.mock("../src/server/runtime", () => ({
  getWebEnv: () => ({
    WEB_BASE_URL: "https://app.test",
    SENTRY_DSN: "https://sentry.test/dsn",
    AGENT_PASTE_ENV: "dev",
    CF_WEB_ANALYTICS_TOKEN: "analytics-token",
  }),
}));

vi.mock("../src/server/turnstile", () => ({
  turnstileSiteKey: () => state.turnstileSiteKey(),
}));

import {
  activateBillingReturn,
  getArtifact,
  listArtifacts,
  listAudit,
  listKeys,
  loadAdmin,
  loadAuthedSession,
  loadBilling,
  loadClaimPage,
  loadDashboard,
  loadRootAuth,
  loadRootEnv,
  loadSettings,
} from "../src/server/web-loaders";

const ARTIFACT_ID = "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
const emptyFallback = { data: null, empty: true, error: null };

describe("web server loaders", () => {
  beforeEach(() => {
    state.auth = { user: { email: "user@example.com" }, accessToken: "access-token" };
    state.apiFetchOrEmpty.mockReset();
    state.apiFetchOrEmpty.mockResolvedValue({ data: { ok: true }, empty: false, error: null });
    state.turnstileSiteKey.mockReturnValue("turnstile-site-key");
  });

  it("exposes root env and auth without calling the API", async () => {
    expect(loadRootEnv()).toEqual({
      webBaseUrl: "https://app.test",
      sentry: { dsn: "https://sentry.test/dsn", environment: "dev" },
      analyticsToken: "analytics-token",
    });
    await expect(loadRootAuth()).resolves.toEqual({
      signedIn: true,
      signInHref: "https://app.test/api/auth/sign-in",
    });
  });

  it("handles authenticated session guest, redirect, and signed-in branches", async () => {
    state.auth = { user: null };
    await expect(loadAuthedSession({ allowGuest: true })).resolves.toEqual({ guest: true });
    await expect(loadAuthedSession({ returnPathname: "/settings" })).resolves.toEqual({
      redirectTo: "https://app.test/api/auth/sign-in?returnPathname=%2Fsettings",
    });

    state.auth = { user: { email: "user@example.com" }, accessToken: "access-token" };
    state.apiFetchOrEmpty.mockResolvedValueOnce({
      data: { workspace: { id: "ws_1" } },
      empty: false,
      error: null,
    });
    await expect(loadAuthedSession({})).resolves.toMatchObject({
      user: { email: "user@example.com" },
      isOperator: false,
      apiSession: { data: { workspace: { id: "ws_1" } } },
    });
    expect(state.apiFetchOrEmpty).toHaveBeenCalledWith("/v1/auth/web/callback", {
      method: "POST",
      accessToken: "access-token",
    });
  });

  it("returns null dashboard data when signed out and fetches workspace data when signed in", async () => {
    state.auth = { user: null };
    await expect(loadDashboard()).resolves.toEqual({ workspace: null, artifacts: null, audit: null });
    expect(state.apiFetchOrEmpty).not.toHaveBeenCalled();

    state.auth = { user: { email: "user@example.com" }, accessToken: "access-token" };
    state.apiFetchOrEmpty
      .mockResolvedValueOnce({ data: { workspace: { name: "Demo" } }, empty: false, error: null })
      .mockResolvedValueOnce({ data: { items: [] }, empty: false, error: null })
      .mockResolvedValueOnce({ data: { items: [] }, empty: false, error: null });

    await expect(loadDashboard()).resolves.toMatchObject({
      workspace: { data: { workspace: { name: "Demo" } } },
      artifacts: { data: { items: [] } },
      audit: { data: { items: [] } },
    });
    expect(state.apiFetchOrEmpty).toHaveBeenNthCalledWith(1, "/v1/web/workspace", { accessToken: "access-token" });
    expect(state.apiFetchOrEmpty).toHaveBeenNthCalledWith(2, "/v1/web/artifacts?limit=100", {
      accessToken: "access-token",
    });
    expect(state.apiFetchOrEmpty).toHaveBeenNthCalledWith(3, "/v1/web/audit?limit=6", { accessToken: "access-token" });
  });

  it("returns empty fallbacks for list loaders when signed out", async () => {
    state.auth = { user: null };

    await expect(listArtifacts()).resolves.toEqual(emptyFallback);
    await expect(getArtifact({ artifactId: ARTIFACT_ID })).resolves.toEqual(emptyFallback);
    await expect(listAudit()).resolves.toEqual(emptyFallback);
    await expect(listKeys()).resolves.toEqual(emptyFallback);
    await expect(loadSettings()).resolves.toEqual(emptyFallback);
    expect(state.apiFetchOrEmpty).not.toHaveBeenCalled();
  });

  it("fetches list loaders with the member token when signed in", async () => {
    await listArtifacts();
    await getArtifact({ artifactId: ARTIFACT_ID });
    await listAudit();
    await listKeys();
    await loadSettings();

    expect(state.apiFetchOrEmpty).toHaveBeenNthCalledWith(1, "/v1/web/artifacts", { accessToken: "access-token" });
    expect(state.apiFetchOrEmpty).toHaveBeenNthCalledWith(2, `/v1/web/artifacts/${ARTIFACT_ID}`, {
      accessToken: "access-token",
    });
    expect(state.apiFetchOrEmpty).toHaveBeenNthCalledWith(3, "/v1/web/audit", { accessToken: "access-token" });
    expect(state.apiFetchOrEmpty).toHaveBeenNthCalledWith(4, "/v1/web/keys", { accessToken: "access-token" });
    expect(state.apiFetchOrEmpty).toHaveBeenNthCalledWith(5, "/v1/web/settings", { accessToken: "access-token" });
  });

  it("returns billing empty fallbacks when signed out", async () => {
    state.auth = { user: null };

    await expect(loadBilling()).resolves.toEqual({
      status: emptyFallback,
      invoices: emptyFallback,
    });
    await expect(activateBillingReturn({ sessionId: "cs_test" })).resolves.toEqual({
      status: emptyFallback,
      invoices: emptyFallback,
    });
    expect(state.apiFetchOrEmpty).not.toHaveBeenCalled();
  });

  it("loads billing status and invoices for signed-in members", async () => {
    const status = { data: { plan: "pro" }, empty: false, error: null };
    const invoices = { data: { items: [] }, empty: false, error: null };
    state.apiFetchOrEmpty.mockResolvedValueOnce(status).mockResolvedValueOnce(invoices);

    await expect(loadBilling()).resolves.toEqual({ status, invoices });
    expect(state.apiFetchOrEmpty).toHaveBeenNthCalledWith(1, "/v1/web/billing", { accessToken: "access-token" });
    expect(state.apiFetchOrEmpty).toHaveBeenNthCalledWith(2, "/v1/web/billing/invoices", {
      accessToken: "access-token",
    });
  });

  it("activates billing return and refreshes invoices for signed-in members", async () => {
    const status = { data: { plan: "pro" }, empty: false, error: null };
    const invoices = { data: { items: [{ id: "inv_1" }] }, empty: false, error: null };
    state.apiFetchOrEmpty.mockResolvedValueOnce(status).mockResolvedValueOnce(invoices);

    await expect(activateBillingReturn({ sessionId: "cs_test_123" })).resolves.toEqual({ status, invoices });
    expect(state.apiFetchOrEmpty).toHaveBeenNthCalledWith(1, "/v1/web/billing/return?session_id=cs_test_123", {
      accessToken: "access-token",
    });
    expect(state.apiFetchOrEmpty).toHaveBeenNthCalledWith(2, "/v1/web/billing/invoices", {
      accessToken: "access-token",
    });
  });

  it("denies admin access without a user or operator role", async () => {
    state.auth = { user: null };
    await expect(loadAdmin({})).resolves.toEqual({ allowed: false });

    state.auth = { user: { email: "user@example.com" }, accessToken: "access-token" };
    await expect(loadAdmin({})).resolves.toEqual({ allowed: false });
    expect(state.apiFetchOrEmpty).not.toHaveBeenCalled();
  });

  it("returns empty admin data for operators without an access token", async () => {
    state.auth = { user: { email: "operator@example.com" }, role: "admin" };

    await expect(loadAdmin({ focus: "security" })).resolves.toEqual({
      allowed: true,
      lockdowns: emptyFallback,
      events: emptyFallback,
    });
    expect(state.apiFetchOrEmpty).not.toHaveBeenCalled();
  });

  it("loads admin lockdowns and events for operators with an access token", async () => {
    state.auth = { user: { email: "operator@example.com" }, accessToken: "operator-token", roles: ["admin"] };
    const lockdowns = { data: { items: [] }, empty: false, error: null };
    const events = { data: { items: [] }, empty: false, error: null };
    state.apiFetchOrEmpty.mockResolvedValueOnce(lockdowns).mockResolvedValueOnce(events);

    await expect(loadAdmin({ focus: "security", request_id: "req_1" })).resolves.toEqual({
      allowed: true,
      lockdowns,
      events,
    });
    expect(state.apiFetchOrEmpty).toHaveBeenNthCalledWith(1, "/v1/web/admin/lockdowns", {
      accessToken: "operator-token",
    });
    expect(state.apiFetchOrEmpty).toHaveBeenNthCalledWith(2, "/v1/web/admin/events?focus=security&request_id=req_1", {
      accessToken: "operator-token",
    });
  });

  it("exposes the claim page Turnstile site key", () => {
    expect(loadClaimPage()).toEqual({ turnstileSiteKey: "turnstile-site-key" });
  });
});
