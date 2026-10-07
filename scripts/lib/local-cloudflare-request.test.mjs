import { createServer } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { localCloudflareRequest } from "./local-cloudflare-request.mjs";

afterEach(() => vi.unstubAllGlobals());

describe("local Cloudflare request boundary", () => {
  it.each([
    "http://example.com/path",
    "https://127.0.0.1/path",
    "http://127.0.0.1.example.com/path",
    "http://127.0.0.2/path",
    "http://user:password@127.0.0.1/path",
  ])("rejects %s without making a request", (url) => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(() => localCloudflareRequest(url)).toThrow(/require HTTP on 127.0.0.1/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects an explicit request to follow redirects", () => {
    expect(() => localCloudflareRequest("http://127.0.0.1:1234", { redirect: "follow" })).toThrow(/follow redirects/);
  });

  it("serves local requests, blocks redirected requests, and preserves manual sign-in redirects", async () => {
    let redirectedRequests = 0;
    const server = createServer((request, response) => {
      if (request.url === "/redirect") {
        response.writeHead(302, { location: "/target", "set-cookie": "fixture=session" });
      } else if (request.url === "/target") {
        redirectedRequests++;
      }
      response.end("local fixture");
    });
    await new Promise((done) => server.listen(0, "127.0.0.1", done));
    try {
      const base = `http://127.0.0.1:${server.address().port}`;
      expect(await (await localCloudflareRequest(base)).text()).toBe("local fixture");
      await expect(localCloudflareRequest(`${base}/redirect`)).rejects.toThrow();
      const signIn = await localCloudflareRequest(`${base}/redirect`, { redirect: "manual" });
      expect(signIn.status).toBe(302);
      expect(signIn.headers.get("set-cookie")).toBe("fixture=session");
      expect(redirectedRequests).toBe(0);
    } finally {
      server.closeAllConnections();
      await new Promise((done) => server.close(done));
    }
  });
});
