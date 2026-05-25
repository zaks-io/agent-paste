import { beforeEach, describe, expect, it, vi } from "vitest";

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

import { ApiError } from "../src/server/api-client";
import { createKeyFn, revokeKeyFn, saveSettingsFn } from "../src/server/web-mutations";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("web server mutations", () => {
  beforeEach(() => {
    state.auth = { user: { email: "user@example.com" }, accessToken: "access-token" };
    state.requestId = "req_local";
    state.apiFetch.mockReset();
  });

  it("creates keys, revokes keys, and saves settings with bearer access and idempotency", async () => {
    state.apiFetch
      .mockResolvedValueOnce({ api_key: { id: "key_1" }, secret: "secret" })
      .mockResolvedValueOnce({ api_key: { id: "key_1" }, revoked_at: "2026-01-01T00:00:00.000Z" })
      .mockResolvedValueOnce({ workspace_name: "Demo", auto_deletion_days: 14 });

    await expect(createKeyFn({ data: { name: "Dashboard Key" } })).resolves.toMatchObject({
      data: { secret: "secret" },
      error: null,
    });
    await expect(revokeKeyFn({ data: { apiKeyId: "key_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9" } })).resolves.toMatchObject({
      data: { api_key: { id: "key_1" } },
      error: null,
    });
    await expect(saveSettingsFn({ data: { workspace_name: "Demo", auto_deletion_days: 14 } })).resolves.toMatchObject({
      data: { workspace_name: "Demo" },
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
    await expect(createKeyFn({ data: { name: "" } })).resolves.toMatchObject({
      data: null,
      error: { status: 400, code: "validation_error" },
    });
    await expect(revokeKeyFn({ data: { apiKeyId: "not-a-key" } })).resolves.toMatchObject({
      data: null,
      error: { status: 400, code: "validation_error" },
    });
    await expect(saveSettingsFn({ data: { workspace_name: "", auto_deletion_days: 0 } })).resolves.toMatchObject({
      data: null,
      error: { status: 400, code: "validation_error" },
    });
    expect(state.apiFetch).not.toHaveBeenCalled();
  });

  it("returns unauthorized when the WorkOS session is missing", async () => {
    state.auth = { user: null };

    await expect(createKeyFn({ data: { name: "Key" } })).resolves.toMatchObject({
      data: null,
      error: { status: 401, code: "unauthorized", message: "Not signed in." },
    });
  });

  it("maps API and network failures into mutation results", async () => {
    state.apiFetch
      .mockRejectedValueOnce(new ApiError(409, "idempotency_in_flight", "Already running", "req_api"))
      .mockRejectedValueOnce(new Error("network down"))
      .mockRejectedValueOnce("boom");

    await expect(createKeyFn({ data: { name: "Key" } })).resolves.toMatchObject({
      data: null,
      error: { status: 409, code: "idempotency_in_flight", message: "Already running", requestId: "req_api" },
    });
    await expect(createKeyFn({ data: { name: "Key" } })).resolves.toMatchObject({
      data: null,
      error: { status: 0, code: "network_error", message: "network down", requestId: "req_local" },
    });
    await expect(createKeyFn({ data: { name: "Key" } })).resolves.toMatchObject({
      data: null,
      error: { status: 0, code: "network_error", message: "request failed", requestId: "req_local" },
    });
  });
});
