import { mintUploadToken } from "@agent-paste/tokens/upload-url";
import { describe, expect, it } from "vitest";
import type { Env } from "./env.js";
import { uploadFilePath, verifyUploadToken } from "./put.js";

function mockContext(pathname: string, search = ""): { req: { raw: { url: string } } } {
  return {
    req: {
      raw: {
        url: `https://upload.test${pathname}${search}`,
      },
    },
  };
}

describe("put upload path and token verification", () => {
  it("extracts file path from upload session URLs", () => {
    const context = mockContext("/v1/upload-sessions/upl_1/files/index.html", "?token=x");
    expect(uploadFilePath(context as never)).toBe("index.html");
    expect(uploadFilePath(mockContext("/v1/upload-sessions/upl_1/finalize") as never)).toBe("");
  });

  it.each(["%ZZ", "%", "%E0%A4%A"])("returns empty string for malformed percent-escape %j", (encodedPath) => {
    expect(uploadFilePath(mockContext(`/v1/upload-sessions/upl_1/files/${encodedPath}`, "?token=x") as never)).toBe("");
  });

  it("returns null for missing or invalid tokens", async () => {
    const env: Env = { UPLOAD_SIGNING_SECRET: "secret" };
    expect(await verifyUploadToken(null, env)).toBeNull();
    expect(await verifyUploadToken("not-a-token", env)).toBeNull();
  });

  it("verifies signed upload tokens", async () => {
    const env: Env = { UPLOAD_SIGNING_SECRET: "secret" };
    const token = await mintUploadToken(
      {
        sid: "upl_1",
        wid: "00000000-0000-4000-8000-000000000001",
        path: "index.html",
        key: "artifacts/art_1/revisions/rev_1/files/index.html",
        size: 5,
        exp: Math.floor(Date.now() / 1000) + 3600,
      },
      "secret",
    );
    const payload = await verifyUploadToken(token, env);
    expect(payload).toMatchObject({ sid: "upl_1", path: "index.html", size: 5 });
  });
});
