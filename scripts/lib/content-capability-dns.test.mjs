import { describe, expect, it, vi } from "vitest";
import { ensureContentCapabilityDns } from "./content-capability-dns.mjs";

const apiToken = "test-cloudflare-token";
const apiHost = "https://api.cloudflare.test/client/v4";

describe("content capability DNS", () => {
  it("creates the expected wildcard record when none exists", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([{ id: "zone_1", name: "agent-paste.sh", status: "active" }]))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse({ id: "record_1" }));

    await expect(ensureContentCapabilityDns({ apiToken, apiHost }, { fetchImpl })).resolves.toBe("created");

    const [url, init] = fetchImpl.mock.calls[2];
    expect(url).toBe(`${apiHost}/zones/zone_1/dns_records`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      type: "AAAA",
      name: "*.agent-paste.sh",
      content: "100::",
      proxied: true,
      ttl: 1,
      comment: "Capability-scoped content Worker route",
    });
  });

  it("leaves the exact existing record unchanged", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([{ id: "zone_1", name: "agent-paste.sh", status: "active" }]))
      .mockResolvedValueOnce(
        jsonResponse([
          {
            id: "record_1",
            name: "*.agent-paste.sh",
            type: "AAAA",
            content: "100::",
            proxied: true,
          },
        ]),
      );

    await expect(ensureContentCapabilityDns({ apiToken, apiHost }, { fetchImpl })).resolves.toBe("unchanged");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("refuses to overwrite a conflicting wildcard record", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([{ id: "zone_1", name: "agent-paste.sh", status: "active" }]))
      .mockResolvedValueOnce(
        jsonResponse([
          {
            id: "record_1",
            name: "*.agent-paste.sh",
            type: "AAAA",
            content: "2001:db8::1",
            proxied: true,
          },
        ]),
      );

    await expect(ensureContentCapabilityDns({ apiToken, apiHost }, { fetchImpl })).rejects.toThrow(
      /Refusing to overwrite/,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("fails loudly when the active zone cannot be resolved uniquely", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse([]));

    await expect(ensureContentCapabilityDns({ apiToken, apiHost }, { fetchImpl })).rejects.toThrow(
      /exactly one active Cloudflare zone/,
    );
  });

  it("requires a token before making a request", async () => {
    const fetchImpl = vi.fn();
    await expect(ensureContentCapabilityDns({ apiToken: "", apiHost }, { fetchImpl })).rejects.toThrow(
      /CLOUDFLARE_API_TOKEN/,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("surfaces Cloudflare API errors without including the token", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      jsonResponse(undefined, {
        status: 403,
        success: false,
        errors: [{ code: 9109, message: "Missing DNS Write permission" }],
      }),
    );

    const result = ensureContentCapabilityDns({ apiToken, apiHost }, { fetchImpl });
    await expect(result).rejects.toThrow(/9109: Missing DNS Write permission/);
    await expect(result).rejects.not.toThrow(apiToken);
  });
});

function jsonResponse(result, options = {}) {
  const { status = 200, success = true, errors = [] } = options;
  return new Response(JSON.stringify({ success, result, errors }), {
    status,
    headers: { "content-type": "application/json" },
  });
}
