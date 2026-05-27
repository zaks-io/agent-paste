import { STREAM_INTERNAL_SECRET_HEADER } from "@agent-paste/worker-runtime";
import { describe, expect, it, vi } from "vitest";
import { authorizeLiveUpdate, parseAuthorizeAccessLinkBody } from "./authorize.js";

describe("authorizeLiveUpdate", () => {
  it("returns null when the API binding throws", async () => {
    const api = {
      fetch: vi.fn(async () => {
        throw new Error("binding down");
      }),
    };
    const result = await authorizeLiveUpdate(
      api,
      { kind: "dashboard", artifact_id: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9" },
      {},
    );
    expect(result).toBeNull();
  });

  it("returns null when the API rejects authorization", async () => {
    const api = {
      fetch: vi.fn(async () => new Response("nope", { status: 404 })),
    };
    const result = await authorizeLiveUpdate(
      api,
      { kind: "dashboard", artifact_id: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9" },
      { authorization: "Bearer token" },
    );
    expect(result).toBeNull();
    expect(api.fetch).toHaveBeenCalled();
  });

  it("returns null when the API body fails schema validation", async () => {
    const api = {
      fetch: vi.fn(async () => Response.json({ artifact_id: "bad" })),
    };
    const result = await authorizeLiveUpdate(
      api,
      { kind: "dashboard", artifact_id: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9" },
      {},
    );
    expect(result).toBeNull();
  });

  it("forwards authorization and the shared internal secret", async () => {
    const pointer = {
      revision_id: "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
      iframe_src: "https://content.test/v/art.rev/index.html",
      render_mode: "html" as const,
      title: "Demo",
    };
    const api = {
      fetch: vi.fn(async (request: Request) => {
        expect(request.headers.get("authorization")).toBe("Bearer secret");
        expect(request.headers.get(STREAM_INTERNAL_SECRET_HEADER)).toBe("stream-internal-secret");
        expect(request.headers.get("x-agent-paste-caller")).toBeNull();
        return Response.json({
          artifact_id: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
          audience: "dashboard",
          pointer,
        });
      }),
    };
    const result = await authorizeLiveUpdate(
      api,
      { kind: "dashboard", artifact_id: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9" },
      { authorization: "Bearer secret", streamInternalSecret: "stream-internal-secret" },
    );
    expect(result).toMatchObject({ audience: "dashboard", pointer });
  });
});

describe("parseAuthorizeAccessLinkBody", () => {
  it("rejects non-objects, missing blobs, and invalid payloads", () => {
    expect(parseAuthorizeAccessLinkBody("0123456789ABCDEF", null)).toBeNull();
    expect(parseAuthorizeAccessLinkBody("0123456789ABCDEF", { blob: "" })).toBeNull();
    expect(parseAuthorizeAccessLinkBody("0123456789ABCDEF", { blob: 1 })).toBeNull();
    expect(parseAuthorizeAccessLinkBody("bad-id", { blob: "x" })).toBeNull();
  });

  it("parses a valid access-link authorize request", () => {
    const parsed = parseAuthorizeAccessLinkBody("0123456789ABCDEF", { blob: "signed-blob" });
    expect(parsed).toEqual({
      kind: "access_link",
      public_id: "0123456789ABCDEF",
      blob: "signed-blob",
    });
  });
});
