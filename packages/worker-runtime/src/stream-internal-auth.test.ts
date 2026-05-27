import { describe, expect, it } from "vitest";
import {
  isAuthorizedStreamInternalRequest,
  STREAM_INTERNAL_SECRET_HEADER,
  streamInternalSecretHeaders,
} from "./stream-internal-auth.js";

describe("stream internal auth", () => {
  it("rejects missing, wrong, or spoofed caller headers without the shared secret", () => {
    const secret = "stream-internal-secret";
    expect(isAuthorizedStreamInternalRequest(new Request("https://api.test/x"), secret)).toBe(false);
    expect(
      isAuthorizedStreamInternalRequest(
        new Request("https://api.test/x", { headers: { "x-agent-paste-caller": "stream" } }),
        secret,
      ),
    ).toBe(false);
    expect(
      isAuthorizedStreamInternalRequest(
        new Request("https://api.test/x", { headers: { [STREAM_INTERNAL_SECRET_HEADER]: "wrong" } }),
        secret,
      ),
    ).toBe(false);
  });

  it("accepts only the configured shared secret header", () => {
    const secret = "stream-internal-secret";
    expect(
      isAuthorizedStreamInternalRequest(
        new Request("https://api.test/x", { headers: { [STREAM_INTERNAL_SECRET_HEADER]: secret } }),
        secret,
      ),
    ).toBe(true);
  });

  it("builds stream-to-api internal authorize headers", () => {
    expect(streamInternalSecretHeaders("stream-internal-secret")).toMatchObject({
      [STREAM_INTERNAL_SECRET_HEADER]: "stream-internal-secret",
    });
  });

  it("rejects requests when the configured secret is missing", () => {
    expect(
      isAuthorizedStreamInternalRequest(
        new Request("https://api.test/x", { headers: { [STREAM_INTERNAL_SECRET_HEADER]: "stream-internal-secret" } }),
        undefined,
      ),
    ).toBe(false);
  });

  it("omits the internal secret header when no secret is configured", () => {
    expect(streamInternalSecretHeaders(undefined)).toEqual({
      accept: "application/json",
      "content-type": "application/json",
    });
  });
});
