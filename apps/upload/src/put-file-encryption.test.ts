import { mintUploadToken } from "@agent-paste/tokens/upload-url";
import { describe, expect, it } from "vitest";
import { type Env, handleRequest } from "./index.js";

describe("upload put file encryption", () => {
  it("returns 401 for malformed percent-escape paths instead of 500", async () => {
    const response = await handleRequest(
      new Request("https://upload.test/v1/upload-sessions/upl_1/files/%ZZ?token=not-a-token", {
        method: "PUT",
        headers: { "content-length": "5" },
        body: "hello",
      }),
      { UPLOAD_SIGNING_SECRET: "secret" },
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "not_authenticated" } });
  });

  it("stores encrypted bytes with R2 encryption metadata", async () => {
    const objectKey = "artifacts/art_1/revisions/rev_1/files/index.html";
    const putCalls: Array<{
      key: string;
      value: Uint8Array;
      options?: { customMetadata?: Record<string, string> };
    }> = [];
    const env: Env = {
      UPLOAD_SIGNING_SECRET: "secret",
      ARTIFACT_BYTES_ENCRYPTION_KEY: "test-artifact-bytes-encryption-key",
      ARTIFACTS: {
        async put(key, value, options) {
          putCalls.push({
            key,
            value: value instanceof Uint8Array ? value : new Uint8Array(await new Response(value).arrayBuffer()),
            options,
          });
        },
        async head() {
          return null;
        },
      },
      DB: {
        async recordUploadedFile() {
          return undefined;
        },
      },
    };
    const token = await mintUploadToken(
      {
        sid: "upl_1",
        wid: "00000000-0000-4000-8000-000000000001",
        path: "index.html",
        key: objectKey,
        size: 5,
        exp: Math.floor(Date.now() / 1000) + 3600,
      },
      "secret",
    );
    const response = await handleRequest(
      new Request(`https://upload.test/v1/upload-sessions/upl_1/files/index.html?token=${encodeURIComponent(token)}`, {
        method: "PUT",
        headers: { "content-length": "5", "content-type": "text/html" },
        body: "hello",
      }),
      env,
    );

    expect(response.status).toBe(204);
    expect(putCalls).toHaveLength(1);
    expect(putCalls[0]?.key).toBe(objectKey);
    expect(putCalls[0]?.options?.customMetadata).toMatchObject({
      enc_alg: "aes-256-gcm",
      enc_aad_v: "v1",
      enc_kid: "1",
    });
    expect(putCalls[0]?.value.byteLength).toBe(5 + 28);
  });
});
