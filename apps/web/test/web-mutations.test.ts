import { beforeEach, describe, expect, it, vi } from "vitest";
import { lockdownRow } from "./fixtures";

const state = vi.hoisted(() => ({
  auth: { user: { email: "user@example.com" }, accessToken: "access-token" } as {
    user: { email: string } | null;
    accessToken?: string;
  },
  requestId: "req_local",
  apiFetch: vi.fn(),
}));

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    const builder = {
      inputValidator: () => builder,
      handler: (handler: (input: { data: unknown }) => unknown) => (input: { data: unknown }) => handler(input),
    };
    return builder;
  },
  getGlobalStartContext: () => ({
    auth: () =>
      state.auth.user
        ? {
            ...state.auth,
            sessionId: "session_1",
            claims: {},
          }
        : { user: null },
  }),
}));

vi.mock("@workos/authkit-tanstack-react-start", () => ({
  getAuth: () => state.auth,
}));

vi.mock("../src/server/runtime", () => ({
  getRequestId: () => state.requestId,
}));

vi.mock("../src/server/api-client", async () => {
  const actual = await vi.importActual<typeof import("../src/server/api-client")>("../src/server/api-client");
  return {
    ApiError: actual.ApiError,
    apiFetch: (...args: unknown[]) => state.apiFetch(...args),
  };
});

vi.mock("../src/server/turnstile", () => ({
  LOCAL_TURNSTILE_BYPASS_TOKEN: "local-turnstile-bypass",
  verifyTurnstileToken: vi.fn(async () => true),
}));

import { ApiError } from "../src/server/api-client";
import { verifyTurnstileToken } from "../src/server/turnstile";
import {
  claimEphemeral,
  createAccessLink,
  createKey,
  liftLockdown,
  mintAccessLink,
  revokeAccessLink,
  revokeKey,
  saveSettings,
  setAccessLinkLockdown,
  setLockdown,
} from "../src/server/web-mutations";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("web server mutations", () => {
  beforeEach(() => {
    state.auth = { user: { email: "user@example.com" }, accessToken: "access-token" };
    state.requestId = "req_local";
    state.apiFetch.mockReset();
    vi.mocked(verifyTurnstileToken).mockReset();
    vi.mocked(verifyTurnstileToken).mockResolvedValue(true);
  });

  it("creates keys, revokes keys, saves settings, and mutates lockdowns with bearer access and idempotency", async () => {
    state.apiFetch
      .mockResolvedValueOnce({ api_key: { id: "key_1" }, secret: "secret" })
      .mockResolvedValueOnce({ api_key: { id: "key_1" }, revoked_at: "2026-01-01T00:00:00.000Z" })
      .mockResolvedValueOnce({ workspace_name: "Demo", auto_deletion_days: 14 })
      .mockResolvedValueOnce(lockdownRow())
      .mockResolvedValueOnce({ ...lockdownRow(), lifted_at: "2026-01-01T00:00:00.000Z" });

    await expect(createKey({ name: "Dashboard Key" })).resolves.toMatchObject({
      data: { secret: "secret" },
      error: null,
    });
    await expect(revokeKey({ apiKeyId: "key_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9" })).resolves.toMatchObject({
      data: { api_key: { id: "key_1" } },
      error: null,
    });
    await expect(saveSettings({ workspace_name: "Demo", auto_deletion_days: 14 })).resolves.toMatchObject({
      data: { workspace_name: "Demo" },
      error: null,
    });
    await expect(
      setLockdown({
        scope: "workspace",
        target_id: "00000000-0000-4000-8000-000000000000",
        reason_code: "abuse",
      }),
    ).resolves.toMatchObject({
      data: { scope: "workspace" },
      error: null,
    });
    await expect(
      liftLockdown({ scope: "workspace", target_id: "00000000-0000-4000-8000-000000000000" }),
    ).resolves.toMatchObject({
      data: { lifted_at: "2026-01-01T00:00:00.000Z" },
      error: null,
    });

    expect(state.apiFetch).toHaveBeenNthCalledWith(
      1,
      "/v1/web/keys",
      expect.objectContaining({
        method: "POST",
        accessToken: "access-token",
        body: JSON.stringify({ name: "Dashboard Key" }),
      }),
    );
    expect(state.apiFetch).toHaveBeenNthCalledWith(
      2,
      "/v1/web/keys/key_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9/revoke",
      expect.objectContaining({ method: "POST", accessToken: "access-token" }),
    );
    expect(state.apiFetch).toHaveBeenNthCalledWith(
      3,
      "/v1/web/settings",
      expect.objectContaining({
        method: "PATCH",
        accessToken: "access-token",
        body: JSON.stringify({ workspace_name: "Demo", auto_deletion_days: 14 }),
      }),
    );
    expect(state.apiFetch).toHaveBeenNthCalledWith(
      4,
      "/v1/web/admin/lockdowns",
      expect.objectContaining({
        method: "POST",
        accessToken: "access-token",
        body: JSON.stringify({
          scope: "workspace",
          target_id: "00000000-0000-4000-8000-000000000000",
          reason_code: "abuse",
        }),
      }),
    );
    expect(state.apiFetch).toHaveBeenNthCalledWith(
      5,
      "/v1/web/admin/lockdowns/workspace/00000000-0000-4000-8000-000000000000",
      expect.objectContaining({ method: "DELETE", accessToken: "access-token" }),
    );
    const idempotencyKeys = new Set<string>();
    for (const [, options] of state.apiFetch.mock.calls) {
      const headers = (options as { headers: Record<string, string> }).headers;
      const idempotencyKey = headers["idempotency-key"];
      expect(idempotencyKey).toMatch(uuidPattern);
      if (!idempotencyKey) {
        throw new Error("expected idempotency key");
      }
      idempotencyKeys.add(idempotencyKey);
    }
    expect(idempotencyKeys.size).toBe(state.apiFetch.mock.calls.length);
  });

  it("returns validation errors before calling the API", async () => {
    await expect(createKey({ name: "" })).resolves.toMatchObject({
      data: null,
      error: { status: 400, code: "validation_error" },
    });
    await expect(revokeKey({ apiKeyId: "not-a-key" })).resolves.toMatchObject({
      data: null,
      error: { status: 400, code: "validation_error" },
    });
    await expect(saveSettings({ workspace_name: "", auto_deletion_days: 0 })).resolves.toMatchObject({
      data: null,
      error: { status: 400, code: "validation_error" },
    });
    await expect(setLockdown({ scope: "workspace", target_id: "", reason_code: "" })).resolves.toMatchObject({
      data: null,
      error: { status: 400, code: "validation_error" },
    });
    await expect(setLockdown({ scope: "workspace", target_id: "   ", reason_code: "abuse" })).resolves.toMatchObject({
      data: null,
      error: { status: 400, code: "validation_error" },
    });
    await expect(liftLockdown({ scope: "invalid", target_id: "" })).resolves.toMatchObject({
      data: null,
      error: { status: 400, code: "validation_error" },
    });
    await expect(liftLockdown({ scope: "workspace", target_id: "   " })).resolves.toMatchObject({
      data: null,
      error: { status: 400, code: "validation_error" },
    });
    await expect(liftLockdown({ scope: "workspace" })).resolves.toMatchObject({
      data: null,
      error: { status: 400, code: "validation_error" },
    });
    expect(state.apiFetch).not.toHaveBeenCalled();
  });

  it("returns unauthorized when the WorkOS session is missing", async () => {
    state.auth = { user: null };

    await expect(createKey({ name: "Key" })).resolves.toMatchObject({
      data: null,
      error: { status: 401, code: "unauthorized", message: "Not signed in." },
    });
  });

  it("maps API and network failures into mutation results", async () => {
    state.apiFetch
      .mockRejectedValueOnce(new ApiError(409, "idempotency_in_flight", "Already running", "req_api"))
      .mockRejectedValueOnce(new Error("network down"))
      .mockRejectedValueOnce("boom");

    await expect(createKey({ name: "Key" })).resolves.toMatchObject({
      data: null,
      error: { status: 409, code: "idempotency_in_flight", message: "Already running", requestId: "req_api" },
    });
    await expect(createKey({ name: "Key" })).resolves.toMatchObject({
      data: null,
      error: { status: 0, code: "network_error", message: "network down", requestId: "req_local" },
    });
    await expect(createKey({ name: "Key" })).resolves.toMatchObject({
      data: null,
      error: { status: 0, code: "network_error", message: "request failed", requestId: "req_local" },
    });
  });

  it("claims ephemeral content after Turnstile verification", async () => {
    state.apiFetch.mockResolvedValueOnce({
      destination_workspace_id: "00000000-0000-4000-8000-000000000001",
      source_workspace_id: "00000000-0000-4000-8000-000000000099",
      artifact_ids: ["art_test"],
      claim_token_id: "ct_test",
    });

    await expect(
      claimEphemeral({ claim_token: "ap_ct_preview_testsecret000000_abc", turnstile_token: "local-turnstile-bypass" }),
    ).resolves.toMatchObject({
      data: {
        destination_workspace_id: "00000000-0000-4000-8000-000000000001",
        artifact_ids: ["art_test"],
      },
      error: null,
    });
    expect(state.apiFetch).toHaveBeenCalledWith("/v1/ephemeral/claim", expect.objectContaining({ method: "POST" }));
  });

  it("rejects claim attempts when Turnstile verification fails", async () => {
    vi.mocked(verifyTurnstileToken).mockResolvedValueOnce(false);
    await expect(
      claimEphemeral({ claim_token: "ap_ct_preview_testsecret000000_abc", turnstile_token: "bad" }),
    ).resolves.toMatchObject({
      data: null,
      error: { code: "turnstile_failed" },
    });
    expect(state.apiFetch).not.toHaveBeenCalled();
  });

  it("surfaces API not_found errors for claim redemption", async () => {
    state.apiFetch.mockRejectedValueOnce(new ApiError(404, "not_found", "not_found", "req_nf"));
    await expect(
      claimEphemeral({ claim_token: "ap_ct_preview_testsecret000000_abc", turnstile_token: "local-turnstile-bypass" }),
    ).resolves.toMatchObject({
      data: null,
      error: { status: 404, code: "not_found" },
    });
  });

  it("rejects malformed Turnstile tokens before calling the API", async () => {
    await expect(
      claimEphemeral({ claim_token: "ap_ct_preview_testsecret000000_abc", turnstile_token: "   " }),
    ).resolves.toMatchObject({
      data: null,
      error: { code: "validation_error", status: 400 },
    });
    expect(verifyTurnstileToken).not.toHaveBeenCalled();
    expect(state.apiFetch).not.toHaveBeenCalled();
  });

  const ARTIFACT_ID = "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
  const ACCESS_LINK_ID = "al_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
  const REVISION_ID = "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";

  it("creates share and revision access links against the artifact route", async () => {
    state.apiFetch
      .mockResolvedValueOnce({ id: ACCESS_LINK_ID, type: "share" })
      .mockResolvedValueOnce({ id: ACCESS_LINK_ID, type: "revision" });

    await expect(createAccessLink({ artifactId: ARTIFACT_ID, type: "share" })).resolves.toMatchObject({
      data: { type: "share" },
      error: null,
    });
    await expect(
      createAccessLink({ artifactId: ARTIFACT_ID, type: "revision", revision_id: REVISION_ID }),
    ).resolves.toMatchObject({ data: { type: "revision" }, error: null });

    expect(state.apiFetch).toHaveBeenNthCalledWith(
      1,
      `/v1/web/artifacts/${ARTIFACT_ID}/access-links`,
      expect.objectContaining({ method: "POST", accessToken: "access-token", body: JSON.stringify({ type: "share" }) }),
    );
    expect(state.apiFetch).toHaveBeenNthCalledWith(
      2,
      `/v1/web/artifacts/${ARTIFACT_ID}/access-links`,
      expect.objectContaining({ body: JSON.stringify({ type: "revision", revision_id: REVISION_ID }) }),
    );
  });

  it("mints a signed URL and never logs it", async () => {
    const url = `https://app.agent-paste.sh/al/AbC123#${"v".repeat(40)}`;
    state.apiFetch.mockResolvedValueOnce({ url });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(mintAccessLink({ accessLinkId: ACCESS_LINK_ID })).resolves.toMatchObject({
      data: { url },
      error: null,
    });
    expect(state.apiFetch).toHaveBeenCalledWith(
      `/v1/web/access-links/${ACCESS_LINK_ID}/mint`,
      expect.objectContaining({ method: "POST", accessToken: "access-token" }),
    );
    for (const call of logSpy.mock.calls) {
      expect(JSON.stringify(call)).not.toContain("#");
    }
    logSpy.mockRestore();
  });

  it("revokes an access link and toggles lockdown set and lift", async () => {
    state.apiFetch
      .mockResolvedValueOnce({ access_link_id: ACCESS_LINK_ID, revoked_at: "2026-01-01T00:00:00.000Z" })
      .mockResolvedValueOnce({ id: ARTIFACT_ID, lockdown: true })
      .mockResolvedValueOnce({ id: ARTIFACT_ID, lockdown: false });

    await expect(revokeAccessLink({ accessLinkId: ACCESS_LINK_ID })).resolves.toMatchObject({
      data: { access_link_id: ACCESS_LINK_ID },
      error: null,
    });
    await expect(setAccessLinkLockdown({ artifactId: ARTIFACT_ID, locked: true })).resolves.toMatchObject({
      data: { lockdown: true },
      error: null,
    });
    await expect(setAccessLinkLockdown({ artifactId: ARTIFACT_ID, locked: false })).resolves.toMatchObject({
      data: { lockdown: false },
      error: null,
    });

    expect(state.apiFetch).toHaveBeenNthCalledWith(
      1,
      `/v1/web/access-links/${ACCESS_LINK_ID}/revoke`,
      expect.objectContaining({ method: "POST" }),
    );
    expect(state.apiFetch).toHaveBeenNthCalledWith(
      2,
      `/v1/web/artifacts/${ARTIFACT_ID}/access-link-lockdown`,
      expect.objectContaining({ method: "POST" }),
    );
    expect(state.apiFetch).toHaveBeenNthCalledWith(
      3,
      `/v1/web/artifacts/${ARTIFACT_ID}/access-link-lockdown/lift`,
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("validates access link mutation inputs before calling the API", async () => {
    await expect(createAccessLink({ artifactId: "nope", type: "share" })).resolves.toMatchObject({
      data: null,
      error: { status: 400, code: "validation_error" },
    });
    await expect(createAccessLink({ artifactId: ARTIFACT_ID, type: "revision" })).resolves.toMatchObject({
      data: null,
      error: { status: 400, code: "validation_error" },
    });
    await expect(mintAccessLink({ accessLinkId: "nope" })).resolves.toMatchObject({
      data: null,
      error: { status: 400, code: "validation_error" },
    });
    await expect(revokeAccessLink({ accessLinkId: "nope" })).resolves.toMatchObject({
      data: null,
      error: { status: 400, code: "validation_error" },
    });
    await expect(setAccessLinkLockdown({ artifactId: "nope", locked: true })).resolves.toMatchObject({
      data: null,
      error: { status: 400, code: "validation_error" },
    });
    expect(state.apiFetch).not.toHaveBeenCalled();
  });
});
