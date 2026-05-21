import { describe, expect, it } from "vitest";
import { type Env, handleRequest, signContentToken } from "./index.js";

describe("content worker", () => {
  it("serves signed R2 content without a DB binding", async () => {
    const token = await signContentToken(
      {
        artifact_id: "art_1",
        revision_id: "rev_1",
        paths: ["index.html"],
        exp: Math.floor(Date.now() / 1000) + 60,
      },
      "secret",
    );
    const env: Env = {
      CONTENT_SIGNING_SECRET: "secret",
      DENYLIST: {
        async get() {
          return null;
        },
      },
      ARTIFACTS: {
        async get(key) {
          expect(key).toBe("artifacts/art_1/revisions/rev_1/files/index.html");
          return {
            body: new Response("<h1>ok</h1>").body,
            size: 11,
          };
        },
      },
    };

    const response = await handleRequest(new Request(`https://content.test/v/${token}/index.html`), env);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    await expect(response.text()).resolves.toBe("<h1>ok</h1>");
  });

  it("rejects denylisted artifacts", async () => {
    const token = await signContentToken(
      {
        artifact_id: "art_1",
        revision_id: "rev_1",
        exp: Math.floor(Date.now() / 1000) + 60,
      },
      "secret",
    );
    const env: Env = {
      CONTENT_SIGNING_SECRET: "secret",
      DENYLIST: {
        async get(key) {
          return key === "artifact:art_1" ? "1" : null;
        },
      },
      ARTIFACTS: {
        async get() {
          throw new Error("should not read denied content");
        },
      },
    };

    const response = await handleRequest(new Request(`https://content.test/v/${token}/index.html`), env);
    expect(response.status).toBe(404);
  });
});
