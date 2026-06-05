import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  auth: {
    user: { email: "user@example.com" },
    accessToken: "access-token",
    role: "admin" as string | undefined,
    roles: undefined as string[] | undefined,
  } as {
    user: { email: string } | null;
    accessToken?: string;
    role?: string;
    roles?: string[];
  },
  requestId: "req_local",
  apiFetchOrEmpty: vi.fn(),
  apiFetch: vi.fn(),
  turnstileSiteKey: vi.fn(() => "turnstile-site-key"),
}));

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validator: ((input: unknown) => unknown) | undefined;
    const builder = {
      inputValidator: (fn: (input: unknown) => unknown) => {
        validator = fn;
        return builder;
      },
      handler: (handler: (input?: { data?: unknown }) => unknown) => (input?: { data?: unknown }) => {
        const data = validator ? validator(input?.data) : input?.data;
        return handler({ data });
      },
    };
    return builder;
  },
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

vi.mock("../src/server/runtime", () => ({
  getWebEnv: () => ({
    WEB_BASE_URL: "https://app.test",
    SENTRY_DSN: "https://sentry.test/dsn",
    AGENT_PASTE_ENV: "dev",
    CF_WEB_ANALYTICS_TOKEN: "analytics-token",
  }),
  getRequestId: () => state.requestId,
}));

vi.mock("../src/server/api-client", async () => {
  const actual = await vi.importActual<typeof import("../src/server/api-client")>("../src/server/api-client");
  return {
    ApiError: actual.ApiError,
    apiFetch: (...args: unknown[]) => state.apiFetch(...args),
    apiFetchOrEmpty: (...args: unknown[]) => state.apiFetchOrEmpty(...args),
  };
});

vi.mock("../src/server/turnstile", () => ({
  LOCAL_TURNSTILE_BYPASS_TOKEN: "local-turnstile-bypass",
  turnstileSiteKey: () => state.turnstileSiteKey(),
  verifyTurnstileToken: vi.fn(async () => true),
}));

import {
  activateBillingReturnFn,
  getArtifactFn,
  healthFn,
  listAccessLinksFn,
  listArtifactAccessLinksFn,
  listArtifactRevisionsFn,
  listArtifactsFn,
  listAuditFn,
  listKeysFn,
  loadAdminFn,
  loadAuthedSessionFn,
  loadBillingFn,
  loadClaimPageFn,
  loadDashboardFn,
  loadRootAuthFn,
  loadRootEnvFn,
  loadSettingsFn,
} from "../src/rpc/web-loaders";
import {
  claimEphemeralFn,
  createAccessLinkFn,
  createKeyFn,
  liftLockdownFn,
  mintAccessLinkFn,
  openPortalFn,
  revokeAccessLinkFn,
  revokeKeyFn,
  saveSettingsFn,
  setAccessLinkLockdownFn,
  setLockdownFn,
  startCheckoutFn,
} from "../src/rpc/web-mutations";

const ARTIFACT_ID = "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
const ACCESS_LINK_ID = "al_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";

describe("web RPC bridge", () => {
  beforeEach(() => {
    state.auth = { user: { email: "user@example.com" }, accessToken: "access-token", role: "admin" };
    state.requestId = "req_local";
    state.apiFetchOrEmpty.mockReset();
    state.apiFetch.mockReset();
    state.apiFetchOrEmpty.mockResolvedValue({ data: { ok: true }, empty: false, error: null });
    state.apiFetch.mockResolvedValue({ ok: true });
    state.turnstileSiteKey.mockReturnValue("turnstile-site-key");
  });

  it("returns the web health payload", async () => {
    await expect(healthFn()).resolves.toEqual({ ok: true, app: "web" });
  });

  it("delegates loader RPC wrappers through dynamic imports", async () => {
    await expect(loadRootEnvFn()).resolves.toMatchObject({ webBaseUrl: "https://app.test" });
    await expect(loadRootAuthFn()).resolves.toMatchObject({ signedIn: true });

    state.auth = { user: null };
    await expect(loadAuthedSessionFn({ data: { allowGuest: true } })).resolves.toEqual({ guest: true });
    state.auth = { user: { email: "user@example.com" }, accessToken: "access-token", role: "admin" };
    await expect(loadDashboardFn()).resolves.toMatchObject({ workspace: { data: { ok: true } } });
    await expect(listArtifactsFn()).resolves.toMatchObject({ data: { ok: true } });
    await expect(getArtifactFn({ data: { artifactId: ARTIFACT_ID } })).resolves.toMatchObject({ data: { ok: true } });
    await expect(listAuditFn()).resolves.toMatchObject({ data: { ok: true } });
    await expect(listKeysFn()).resolves.toMatchObject({ data: { ok: true } });
    await expect(listAccessLinksFn()).resolves.toMatchObject({ data: { ok: true } });
    await expect(listArtifactAccessLinksFn({ data: { artifactId: ARTIFACT_ID } })).resolves.toMatchObject({
      data: { ok: true },
    });
    await expect(listArtifactRevisionsFn({ data: { artifactId: ARTIFACT_ID } })).resolves.toMatchObject({
      data: { ok: true },
    });
    await expect(loadSettingsFn()).resolves.toMatchObject({ data: { ok: true } });
    await expect(loadBillingFn()).resolves.toMatchObject({
      status: { data: { ok: true } },
      invoices: { data: { ok: true } },
    });
    await expect(activateBillingReturnFn({ data: { sessionId: "cs_test" } })).resolves.toMatchObject({
      status: { data: { ok: true } },
      invoices: { data: { ok: true } },
    });
    await expect(loadAdminFn({ data: { focus: "security" } })).resolves.toMatchObject({
      allowed: true,
      lockdowns: { data: { ok: true } },
      events: { data: { ok: true } },
    });
    await expect(loadClaimPageFn()).resolves.toEqual({ turnstileSiteKey: "turnstile-site-key" });

    expect(state.apiFetchOrEmpty).toHaveBeenCalledWith(
      "/v1/web/billing/return?session_id=cs_test",
      expect.objectContaining({ accessToken: "access-token" }),
    );
    expect(state.apiFetchOrEmpty).toHaveBeenCalledWith(
      "/v1/web/admin/events?focus=security",
      expect.objectContaining({ accessToken: "access-token" }),
    );
  });

  it("delegates mutation RPC wrappers through dynamic imports", async () => {
    await expect(createKeyFn({ data: { name: "Dashboard Key" } })).resolves.toMatchObject({
      data: { ok: true },
      error: null,
    });
    await expect(revokeKeyFn({ data: { apiKeyId: "key_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9" } })).resolves.toMatchObject({
      data: { ok: true },
      error: null,
    });
    await expect(
      createAccessLinkFn({ data: { artifactId: ARTIFACT_ID, type: "share" } }),
    ).resolves.toMatchObject({ data: { ok: true }, error: null });
    await expect(mintAccessLinkFn({ data: { accessLinkId: ACCESS_LINK_ID } })).resolves.toMatchObject({
      data: { ok: true },
      error: null,
    });
    await expect(revokeAccessLinkFn({ data: { accessLinkId: ACCESS_LINK_ID } })).resolves.toMatchObject({
      data: { ok: true },
      error: null,
    });
    await expect(
      setAccessLinkLockdownFn({ data: { artifactId: ARTIFACT_ID, locked: true } }),
    ).resolves.toMatchObject({ data: { ok: true }, error: null });
    await expect(
      saveSettingsFn({ data: { workspace_name: "Demo", auto_deletion_days: 14 } }),
    ).resolves.toMatchObject({ data: { ok: true }, error: null });
    await expect(
      setLockdownFn({
        data: {
          scope: "workspace",
          target_id: "00000000-0000-4000-8000-000000000000",
          reason_code: "abuse",
        },
      }),
    ).resolves.toMatchObject({ data: { ok: true }, error: null });
    await expect(
      liftLockdownFn({ data: { scope: "workspace", target_id: "00000000-0000-4000-8000-000000000000" } }),
    ).resolves.toMatchObject({ data: { ok: true }, error: null });
    await expect(startCheckoutFn({ data: { interval: "month" } })).resolves.toMatchObject({
      data: { ok: true },
      error: null,
    });
    await expect(openPortalFn()).resolves.toMatchObject({ data: { ok: true }, error: null });
    await expect(
      claimEphemeralFn({
        data: { claim_token: "ap_ct_preview_testsecret000000_abc", turnstile_token: "local-turnstile-bypass" },
      }),
    ).resolves.toMatchObject({ data: { ok: true }, error: null });

    expect(state.apiFetch).toHaveBeenCalledWith("/v1/web/billing/checkout", expect.objectContaining({ method: "POST" }));
    expect(state.apiFetch).toHaveBeenCalledWith("/v1/web/billing/portal", expect.objectContaining({ method: "POST" }));
    expect(state.apiFetch).toHaveBeenCalledWith("/v1/ephemeral/claim", expect.objectContaining({ method: "POST" }));
  });
});
