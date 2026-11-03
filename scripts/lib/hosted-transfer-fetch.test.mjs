import { describe, expect, it, vi } from "vitest";
import { hostedTransferFetch } from "./hosted-transfer-fetch.mjs";
import { hostedTransferEndpoints } from "./transfer-endpoints.mjs";

const config = hostedTransferEndpoints({
  PR_NUMBER: "686",
  AGENT_PASTE_PR_API_URL: "https://agent-paste-api-pr-686.isaac-a46.workers.dev",
  AGENT_PASTE_PR_UPLOAD_URL: "https://agent-paste-upload-pr-686.isaac-a46.workers.dev",
  AGENT_PASTE_PR_CONTENT_URL: "https://agent-paste-content-pr-686.isaac-a46.workers.dev",
});
const key = "owned-test-key";
const headers = { authorization: `Bearer ${key}`, "idempotency-key": "same-operation" };

describe("hosted acceptance transport", () => {
  it("honors Retry-After without changing the operation, body, credential or idempotency key", async () => {
    const first = new Response("limited", { status: 429, headers: { "retry-after": "60" } });
    const fetchImpl = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(new Response("ok"));
    const sleep = vi.fn();
    const events = [];
    const request = hostedTransferFetch(config, key, { fetchImpl, sleep, onEvent: (event) => events.push(event) });
    const body = JSON.stringify({ files: [] });
    expect((await request(`${config.upload}/v1/upload-sessions`, { method: "POST", headers, body })).status).toBe(200);
    expect(sleep.mock.calls[0][0]).toBe(60_000);
    expect(first.bodyUsed).toBe(true);
    for (const [url, init] of fetchImpl.mock.calls) {
      expect(url).toBe(`${config.upload}/v1/upload-sessions`);
      expect(init).toMatchObject({ body, headers, method: "POST", redirect: "error" });
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
    expect(events).toContainEqual({ type: "hosted_retry", wait_ms: 60_000 });
    expect(JSON.stringify(events)).not.toContain(key);
    expect(JSON.stringify(events)).not.toContain("https:");
  });

  it("supports date Retry-After and a minimum delay for zero", async () => {
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    try {
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(null, { status: 429, headers: { "retry-after": new Date(now + 59_000).toUTCString() } }),
        )
        .mockResolvedValueOnce(new Response(null, { status: 429, headers: { "retry-after": "0" } }))
        .mockResolvedValueOnce(new Response());
      const sleep = vi.fn();
      await hostedTransferFetch(config, key, { fetchImpl, sleep })(`${config.api}/v1/whoami`, { headers });
      expect(sleep.mock.calls[0][0]).toBeGreaterThanOrEqual(58_000);
      expect(sleep.mock.calls[1][0]).toBe(1000);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("stops after four retries, including when the client's own retry loop would retry 429", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 429, headers: { "retry-after": "60" } }));
    const sleep = vi.fn();
    await expect(
      hostedTransferFetch(config, key, { fetchImpl, sleep })(`${config.api}/v1/whoami`, { headers }),
    ).rejects.toThrow("exhausted");
    expect(fetchImpl).toHaveBeenCalledTimes(5);
    expect(sleep).toHaveBeenCalledTimes(4);
  });

  it.each([
    undefined,
    "invalid",
    "121",
    "-1",
  ])("fails without shortening invalid or excessive Retry-After", async (value) => {
    const fetchImpl = vi.fn(
      async () => new Response(null, { status: 429, headers: value ? { "retry-after": value } : {} }),
    );
    const sleep = vi.fn();
    await expect(
      hostedTransferFetch(config, key, { fetchImpl, sleep })(`${config.api}/v1/whoami`, { headers }),
    ).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it.each([400, 401, 403, 404, 409, 422, 500])("leaves HTTP %s failures visible", async (status) => {
    const fetchImpl = vi.fn(async () => new Response(null, { status }));
    const sleep = vi.fn();
    const response = await hostedTransferFetch(config, key, { fetchImpl, sleep })(`${config.api}/v1/whoami`, {
      headers,
    });
    expect(response.status).toBe(status);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("allows signed PUT bytes and signed/capability GETs with no API credential", async () => {
    const fetchImpl = vi.fn(async () => new Response());
    const request = hostedTransferFetch(config, key, { fetchImpl });
    await request(`${config.upload}/v1/upload-sessions/session/files/large.bin?token=private`, {
      method: "PUT",
      body: new Uint8Array([1]),
    });
    await request(`${config.content}/v/private/file.bin`, { headers: { Range: "bytes=5-" } });
    await request("https://0123456789abcdef0123456789abcdef-pr-686.agent-paste.link/large.bin");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it.each([
    [config.api, "/v1/whoami", { headers: { authorization: "Bearer inherited-key" } }],
    [config.content, "/v/private/file.bin", { headers }],
    [config.content, "/v/private/file.bin", { method: "POST" }],
    [config.api, "/v1/artifacts/art_test", { method: "DELETE", headers }],
    [config.api, "/v1/whoami", { headers: { ...headers, cookie: "session=private" } }],
    ["https://api.agent-paste.sh", "/v1/whoami", { headers }],
  ])("rejects requests before sending credentials or mutations to an unexpected target", async (origin, route, init) => {
    const fetchImpl = vi.fn();
    await expect(hostedTransferFetch(config, key, { fetchImpl })(`${origin}${route}`, init)).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
