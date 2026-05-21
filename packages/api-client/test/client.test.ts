import { describe, expect, it } from "vitest";
import { ApiClient } from "../src/index.js";

describe("ApiClient", () => {
  it("uses AGENT_PASTE_API_KEY as a bearer credential", async () => {
    const calls: Request[] = [];
    const client = new ApiClient({
      auth: { type: "api_key", apiKey: "ap_pk_production_0123456789ABCDEF_abcdefghijklmnopqrstuvwxyzABCDEF" },
      apiBaseUrl: "https://api.example.test/",
      fetch: async (input, init) => {
        calls.push(new Request(input, init));
        return Response.json({
          actor: { type: "api_key", id: "key_01ARZ3NDEKTSV4RRFFQ69G5FAV", name: "ci" },
          workspace: {
            id: "00000000-0000-4000-8000-000000000000",
            name: "Demo",
            created_at: "2026-01-01T00:00:00.000Z",
          },
          scopes: ["publish", "read"],
          usage_policy: {
            file_size_cap_bytes: 10,
            artifact_size_cap_bytes: 100,
            file_count_cap: 100,
            actor_rate_limit_per_minute: 60,
            workspace_burst_cap_per_minute: 300,
            upload_session_ttl_seconds: 86400,
            default_ttl_seconds: 2592000,
            min_ttl_seconds: 86400,
            max_ttl_seconds: 7776000,
          },
        });
      },
    });

    await client.whoami();

    expect(calls[0]?.headers.get("authorization")).toBe(
      "Bearer ap_pk_production_0123456789ABCDEF_abcdefghijklmnopqrstuvwxyzABCDEF",
    );
    expect(calls[0]?.url).toBe("https://api.example.test/v1/whoami");
  });

  it("wraps error envelopes", async () => {
    const client = new ApiClient({
      auth: { type: "api_key", apiKey: "ap_pk_production_0123456789ABCDEF_abcdefghijklmnopqrstuvwxyzABCDEF" },
      fetch: async () =>
        Response.json({ error: { code: "invalid_api_key", message: "bad key", request_id: "req_1" } }, { status: 403 }),
    });

    await expect(client.whoami()).rejects.toMatchObject({
      code: "invalid_api_key",
      status: 403,
      requestId: "req_1",
    });
  });
});
