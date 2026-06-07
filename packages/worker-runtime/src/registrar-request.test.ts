import type { RouteContract } from "@agent-paste/contracts";
import type { Context } from "hono";
import { describe, expect, it } from "vitest";
import { MAX_REQUEST_BODY_BYTES, parseRequestBody } from "./registrar-request.js";

const bodyContract = {
  id: "test.body",
  app: "api",
  method: "POST",
  path: "/test",
  auth: "api_key",
  scopes: [],
  idempotency: "none",
  rateLimit: "none",
  requestSchema: "EphemeralProvisionRequest",
  responseSchema: "EmptyObject",
  allowEmptyBody: true,
  errors: ["invalid_request"],
} as RouteContract;

function contextFor(raw: Request): Context {
  return { req: { raw } } as unknown as Context;
}

// A ReadableStream of `byteLength` ASCII spaces, no content-length header — models a
// chunked body whose size is unknown until the stream is drained.
function streamOf(byteLength: number, chunkSize = 64 * 1024): ReadableStream<Uint8Array> {
  let remaining = byteLength;
  return new ReadableStream({
    pull(controller) {
      if (remaining <= 0) {
        controller.close();
        return;
      }
      const size = Math.min(chunkSize, remaining);
      controller.enqueue(new Uint8Array(size).fill(0x20));
      remaining -= size;
    },
  });
}

describe("parseRequestBody request-body cap", () => {
  it("parses a normal small JSON body", async () => {
    const raw = new Request("https://worker.test/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });

    const result = await parseRequestBody(contextFor(raw), bodyContract);

    expect(result.ok).toBe(true);
  });

  it("rejects a body whose content-length exceeds the cap before reading it", async () => {
    let pulled = false;
    // highWaterMark 0 keeps the stream from pulling eagerly at construction, so a
    // pull can only mean readBodyTextCapped started draining the body.
    const body = new ReadableStream<Uint8Array>(
      {
        pull() {
          pulled = true;
          throw new Error("body should not be read when content-length already exceeds the cap");
        },
      },
      { highWaterMark: 0 },
    );
    const raw = {
      headers: new Headers({
        "content-type": "application/json",
        "content-length": String(MAX_REQUEST_BODY_BYTES + 16),
      }),
      body,
    } as unknown as Request;

    const result = await parseRequestBody(contextFor(raw), bodyContract);

    expect(result.ok).toBe(false);
    expect(pulled).toBe(false);
  });

  it("fails closed when the body stream errors mid-read instead of throwing", async () => {
    const body = new ReadableStream<Uint8Array>(
      {
        pull() {
          throw new Error("stream boom");
        },
      },
      { highWaterMark: 0 },
    );
    const raw = {
      headers: new Headers({ "content-type": "application/json" }),
      body,
    } as unknown as Request;

    const result = await parseRequestBody(contextFor(raw), bodyContract);

    expect(result.ok).toBe(false);
  });

  it("rejects an oversized chunked body that omits content-length via the stream cap", async () => {
    const raw = {
      headers: new Headers({ "content-type": "application/json" }),
      body: streamOf(MAX_REQUEST_BODY_BYTES + 64 * 1024),
    } as unknown as Request;

    const result = await parseRequestBody(contextFor(raw), bodyContract);

    expect(result.ok).toBe(false);
  });
});
