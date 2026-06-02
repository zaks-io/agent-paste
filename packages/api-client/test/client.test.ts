import { afterEach, describe, expect, it, vi } from "vitest";
import { type AgentPasteError, ApiClient } from "../src/index.js";

const usagePolicy = {
  file_size_cap_bytes: 10,
  artifact_size_cap_bytes: 100,
  bundle_size_cap_bytes: 100,
  bundles_enabled: true,
  file_count_cap: 100,
  actor_rate_limit_per_minute: 60,
  workspace_burst_cap_per_minute: 300,
  upload_session_ttl_seconds: 86400,
  default_ttl_seconds: 2592000,
  min_ttl_seconds: 86400,
  max_ttl_seconds: 7776000,
  live_artifacts_cap: 50,
  live_update_enabled: false,
  daily_new_artifact_allowance: 100,
  lifetime_revision_ceiling: 100,
};

const pageInfo = { next_cursor: null, has_more: false };
const workspaceId = "00000000-0000-4000-8000-000000000000";
const artifactId = "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
const revisionId = "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
const uploadSessionId = "upl_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
const apiKeyId = "key_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
const apiKeySecret = "ap_pk_production_0123456789ABCDEF_abcdefghijklmnopqrstuvwxyzABCDEF";

afterEach(() => {
  vi.unstubAllEnvs();
});

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
          usage_policy: usagePolicy,
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

  it("reads usage policy from the API base URL", async () => {
    const calls: Request[] = [];
    const client = authedClient({
      apiBaseUrl: "https://api.example.test/",
      fetch: async (input, init) => {
        calls.push(new Request(input, init));
        return Response.json(usagePolicy);
      },
    });

    await expect(client.usagePolicy()).resolves.toEqual(usagePolicy);
    expect(calls[0]?.url).toBe("https://api.example.test/v1/usage-policy");
    expect(calls[0]?.method).toBe("GET");
  });

  it("creates upload sessions with upload base URL, JSON body, idempotency, and API-key auth", async () => {
    const calls: Request[] = [];
    const client = authedClient({
      uploadBaseUrl: "https://upload.example.test/",
      fetch: async (input, init) => {
        calls.push(new Request(input, init));
        return Response.json({
          upload_session_id: uploadSessionId,
          artifact_id: artifactId,
          revision_id: revisionId,
          status: "pending",
          expires_at: "2026-01-01T00:00:00.000Z",
          files: [
            {
              path: "index.html",
              put_url: "https://upload.example.test/put",
              required_headers: {},
              expires_at: "2026-01-01T00:00:00.000Z",
            },
          ],
        });
      },
    });

    await client.uploadSessions.create(
      {
        title: "Demo",
        ttl_seconds: 86_400,
        entrypoint: "index.html",
        files: [{ path: "index.html", size_bytes: 12 }],
      } as Parameters<typeof client.uploadSessions.create>[0],
      "idem_upload",
    );

    const call = calls[0];
    expect(call?.url).toBe("https://upload.example.test/v1/upload-sessions");
    expect(call?.method).toBe("POST");
    expect(call?.headers.get("authorization")).toBe(`Bearer ${apiKeySecret}`);
    expect(call?.headers.get("idempotency-key")).toBe("idem_upload");
    expect(call?.headers.get("content-type")).toBe("application/json");
    await expect(call?.json()).resolves.toMatchObject({ title: "Demo", entrypoint: "index.html" });
  });

  it("URL-encodes upload session ids when finalizing", async () => {
    const calls: Request[] = [];
    const client = authedClient({
      uploadBaseUrl: "https://upload.example.test",
      fetch: async (input, init) => {
        calls.push(new Request(input, init));
        return Response.json(finalizeResult());
      },
    });

    await client.uploadSessions.finalize("upl_with/slash", "idem_finalize");

    expect(calls[0]?.url).toBe("https://upload.example.test/v1/upload-sessions/upl_with%2Fslash/finalize");
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.headers.get("idempotency-key")).toBe("idem_finalize");
  });

  it("mints web keys with bearer auth", async () => {
    const calls: Request[] = [];
    const client = new ApiClient({
      auth: { type: "bearer", getAccessToken: () => "workos-access" },
      apiBaseUrl: "https://api.example.test",
      fetch: async (input, init) => {
        calls.push(new Request(input, init));
        return Response.json(createApiKeyResponse());
      },
    });

    await client.web.keys.create({ name: "agent-paste CLI" }, "idem_web_key");

    expect(calls[0]?.url).toBe("https://api.example.test/v1/web/keys");
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer workos-access");
    expect(calls[0]?.headers.get("idempotency-key")).toBe("idem_web_key");
  });

  it("lists and publishes revisions through the public API client", async () => {
    const calls: Request[] = [];
    const client = authedClient({
      apiBaseUrl: "https://api.example.test/",
      fetch: async (input, init) => {
        calls.push(new Request(input, init));
        const url = calls.at(-1)?.url ?? "";
        if (url.endsWith("/revisions")) {
          return Response.json({
            artifact_id: artifactId,
            items: [
              {
                revision_id: revisionId,
                revision_number: 1,
                status: "published",
                entrypoint: "index.html",
                render_mode: "html",
                file_count: 1,
                size_bytes: 12,
                created_at: "2026-01-01T00:00:00.000Z",
                published_at: "2026-01-01T00:00:00.000Z",
              },
            ],
            page_info: pageInfo,
          });
        }
        return Response.json(publishResult());
      },
    });

    await expect(client.revisions.list(artifactId)).resolves.toMatchObject({
      artifact_id: artifactId,
      items: [{ revision_id: revisionId, revision_number: 1 }],
    });
    await expect(client.revisions.publish(artifactId, revisionId, "idem_publish")).resolves.toMatchObject({
      artifact_id: artifactId,
      revision_id: revisionId,
    });
    expect(calls.map((call) => [call.method, call.url])).toEqual([
      ["GET", `https://api.example.test/v1/artifacts/${artifactId}/revisions`],
      ["POST", `https://api.example.test/v1/artifacts/${artifactId}/revisions/${revisionId}/publish`],
    ]);
    expect(calls[1]?.headers.get("idempotency-key")).toBe("idem_publish");
  });

  it("revokes the current API key with API-key auth", async () => {
    const calls: Request[] = [];
    const client = authedClient({
      apiBaseUrl: "https://api.example.test/",
      fetch: async (input, init) => {
        const request = new Request(input, init);
        calls.push(request);
        return Response.json({
          api_key: { ...apiKeySummary(), revoked_at: "2026-01-02T00:00:00.000Z" },
          revoked_at: "2026-01-02T00:00:00.000Z",
        });
      },
    });

    await expect(client.apiKeys.revokeCurrent()).resolves.toMatchObject({
      api_key: { id: apiKeyId, revoked_at: "2026-01-02T00:00:00.000Z" },
    });

    expect(calls[0]?.url).toBe("https://api.example.test/v1/api-keys/current/revoke");
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.headers.get("authorization")).toBe(`Bearer ${apiKeySecret}`);
  });

  it("puts files without API-client auth and wraps upload failures", async () => {
    const calls: Request[] = [];
    const client = authedClient({
      fetch: async (input, init) => {
        calls.push(new Request(input, init));
        return calls.length === 1
          ? new Response(null, { status: 200 })
          : Response.json(
              { error: { code: "storage_unavailable", message: "R2 down", request_id: "req_put" } },
              { status: 503 },
            );
      },
    });

    await client.putFile("https://r2.example.test/object", new Blob(["hello"]), { "content-type": "text/plain" });
    await expect(client.putFile("https://r2.example.test/object", "bytes")).rejects.toMatchObject({
      code: "storage_unavailable",
      status: 503,
      requestId: "req_put",
    });
    expect(calls[0]?.method).toBe("PUT");
    expect(calls[0]?.headers.get("content-type")).toBe("text/plain");
    expect(calls[0]?.headers.get("authorization")).toBeNull();
  });

  it("requires configured API-key and bearer auth for protected requests", async () => {
    vi.stubEnv("AGENT_PASTE_API_KEY", "");

    await expect(new ApiClient({ fetch: async () => Response.json({}) }).whoami()).rejects.toMatchObject({
      code: "not_authenticated",
      status: 401,
    });
    await expect(
      new ApiClient({
        auth: { type: "api_key", apiKey: apiKeySecret },
        fetch: async () => Response.json({}),
      }).web.keys.create({ name: "key" }, "idem_web_key"),
    ).rejects.toMatchObject({ code: "not_authenticated", status: 401 });
  });

  it("wraps malformed and schema-invalid error responses", async () => {
    const malformed = authedClient({ fetch: async () => new Response("service unavailable", { status: 502 }) });
    await expect(malformed.whoami()).rejects.toMatchObject({
      code: "http_error",
      message: "service unavailable",
      status: 502,
    });

    const envelopeLike = authedClient({
      fetch: async () =>
        Response.json(
          {
            error: {
              code: "custom_code",
              message: "custom message",
              request_id: "req_custom",
              docs: "https://docs.example.test/custom",
            },
          },
          { status: 409 },
        ),
    });
    await expect(envelopeLike.whoami()).rejects.toMatchObject({
      code: "custom_code",
      message: "custom message",
      status: 409,
      requestId: "req_custom",
      docs: "https://docs.example.test/custom",
    });
  });
});

function authedClient(options: ConstructorParameters<typeof ApiClient>[0] = {}) {
  return new ApiClient({
    auth: { type: "api_key", apiKey: apiKeySecret },
    ...options,
  });
}

function apiKeySummary() {
  return {
    id: apiKeyId,
    workspace_id: workspaceId,
    name: "Default",
    public_id: "0123456789ABCDEF",
    scopes: ["publish", "read"],
    revoked_at: null,
    expires_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    last_used_at: null,
  };
}

function createApiKeyResponse() {
  return { api_key: apiKeySummary(), secret: apiKeySecret };
}

function finalizeResult() {
  return {
    upload_session_id: "upl_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
    artifact_id: artifactId,
    revision_id: revisionId,
    status: "draft",
    title: "Demo",
    entrypoint: "index.html",
    file_count: 1,
    size_bytes: 12,
  };
}

function publishResult() {
  return {
    artifact_id: artifactId,
    revision_id: revisionId,
    title: "Demo",
    view_url: "https://app.example.test/a",
    agent_view_url: "https://api.example.test/v1/agent-view/token",
    expires_at: "2026-02-01T00:00:00.000Z",
    bundle: { status: "pending", retry_after_seconds: 5 },
  };
}

// Keeps the imported error class live in this test file while the assertions use
// matchObject to avoid coupling to stack traces.
type _AgentPasteError = AgentPasteError;
