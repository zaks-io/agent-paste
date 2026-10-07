import { mvpUsagePolicy } from "@agent-paste/contracts/workspace";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as credentials from "../src/credentials.js";
import { logout, main, SCHEMA_VERSION } from "../src/index.js";
import { exitCodeFor } from "../src/render.js";

const environmentKey = "test-environment-key";
const stored = {
  api_key: "test-stored-key",
  public_id: "test-stored-id",
  workspace_id: "00000000-0000-4000-8000-000000000000",
  member_email: "agent@example.test",
  expires_at: null,
};
const identity = {
  actor: { type: "api_key", id: "key_01ARZ3NDEKTSV4RRFFQ69G5FAV", name: "Test" },
  workspace: { id: stored.workspace_id, name: "Test", created_at: "2026-01-01T00:00:00.000Z" },
  scopes: ["publish", "read"],
  usage_policy: mvpUsagePolicy,
};

beforeEach(() => {
  vi.stubEnv("AGENT_PASTE_API_URL", "https://api.example.test");
  vi.stubEnv("AGENT_PASTE_API_KEY", "");
  vi.spyOn(process.stdout, "write").mockImplementation((_value, callback) => {
    callback?.();
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  vi.spyOn(credentials, "loadCredential").mockResolvedValue(stored);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("CLI authentication", () => {
  it.each([
    [environmentKey, environmentKey],
    ["", stored.api_key],
  ])("selects the environment key before saved login (%s)", async (configuredKey, expectedKey) => {
    vi.stubEnv("AGENT_PASTE_API_KEY", configuredKey);
    const fetchImpl = vi.fn(async () => Response.json(identity));
    vi.stubGlobal("fetch", fetchImpl);

    await main(["whoami", "--json"]);

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.example.test/v1/whoami");
    expect(new Headers(init.headers).get("authorization")).toBe(`Bearer ${expectedKey}`);
    const result = JSON.parse(String(vi.mocked(process.stdout.write).mock.calls[0]?.[0]));
    expect(result).toMatchObject({ ...identity, authenticated: true, schema_version: SCHEMA_VERSION });
    expect(JSON.stringify(result)).not.toContain(expectedKey);
  });

  it("does not fall back to saved login or report signed out when the environment key is rejected", async () => {
    vi.stubEnv("AGENT_PASTE_API_KEY", environmentKey);
    const fetchImpl = vi.fn(async () =>
      Response.json({ error: { code: "not_authenticated", message: "Rejected credential" } }, { status: 401 }),
    );
    vi.stubGlobal("fetch", fetchImpl);

    const error = await main(["whoami", "--json"]).catch((failure: unknown) => failure);

    expect(exitCodeFor(error)).toBe(2);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(process.stdout.write).not.toHaveBeenCalled();
  });

  it("reports signed out without a request when saved login is expired", async () => {
    vi.mocked(credentials.loadCredential).mockResolvedValue({ ...stored, expires_at: "2020-01-01T00:00:00.000Z" });
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);

    await main(["whoami", "--json"]);

    expect(fetchImpl).not.toHaveBeenCalled();
    const result = JSON.parse(String(vi.mocked(process.stdout.write).mock.calls[0]?.[0]));
    expect(result).toEqual({ schema_version: SCHEMA_VERSION, authenticated: false });
  });

  it("revokes saved login with its own key and leaves environment authentication active", async () => {
    vi.stubEnv("AGENT_PASTE_API_KEY", environmentKey);
    const remove = vi.fn(async () => {
      vi.mocked(credentials.loadCredential).mockResolvedValue(null);
    });
    const fetchImpl = vi.fn(async (url: string, _init: RequestInit) =>
      Response.json(
        url.endsWith("/revoke")
          ? {
              api_key: {
                id: identity.actor.id,
                workspace_id: stored.workspace_id,
                name: "Test",
                public_id: "0123456789ABCDEF",
                scopes: identity.scopes,
                revoked_at: "2026-01-01T00:00:00.000Z",
                expires_at: null,
                created_at: "2026-01-01T00:00:00.000Z",
                last_used_at: null,
              },
              revoked_at: "2026-01-01T00:00:00.000Z",
            }
          : identity,
      ),
    );
    vi.stubGlobal("fetch", fetchImpl);

    await logout({ json: true, quiet: false }, { delete: remove });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [revokeUrl, revokeInit] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(revokeUrl).toBe("https://api.example.test/v1/api-keys/current/revoke");
    expect(new Headers(revokeInit.headers).get("authorization")).toBe(`Bearer ${stored.api_key}`);
    expect(remove).toHaveBeenCalledOnce();
    expect(process.env.AGENT_PASTE_API_KEY).toBe(environmentKey);

    await main(["whoami", "--json"]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [, init] = fetchImpl.mock.calls[1] as [string, RequestInit];
    expect(new Headers(init.headers).get("authorization")).toBe(`Bearer ${environmentKey}`);
  });
});
