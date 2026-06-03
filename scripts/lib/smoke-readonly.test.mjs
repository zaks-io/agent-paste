import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assertApexServes, assertWebServes, assertWorkersHealthy, readonlyConfig } from "./smoke-readonly.mjs";

function htmlResponse(body = "agent-paste home", headers = {}) {
  return new Response(body, { status: 200, headers: { "content-type": "text/html", ...headers } });
}

describe("smoke-readonly readonlyConfig", () => {
  const SAVED = { ...process.env };
  afterEach(() => {
    process.env = { ...SAVED };
  });

  it("rejects targets other than preview/production", () => {
    expect(() => readonlyConfig("pr")).toThrow(/preview or production/);
  });

  it("resolves production custom-domain defaults and leaves jobs undefined", () => {
    const c = readonlyConfig("production");
    expect(c.apiBaseUrl).toBe("https://api.agent-paste.sh");
    expect(c.contentBaseUrl).toBe("https://usercontent.agent-paste.sh");
    expect(c.streamBaseUrl).toBe("https://stream.agent-paste.sh");
    // jobs has no public route in production — must stay undefined so it is skipped.
    expect(c.jobsBaseUrl).toBeUndefined();
  });

  it("exposes a jobs URL for preview", () => {
    expect(readonlyConfig("preview").jobsBaseUrl).toContain("agent-paste-jobs-preview");
  });

  it("honors AGENT_PASTE_<ENV>_<SURFACE>_URL overrides", () => {
    process.env.AGENT_PASTE_PRODUCTION_API_URL = "https://api.example.test";
    expect(readonlyConfig("production").apiBaseUrl).toBe("https://api.example.test");
  });
});

describe("smoke-readonly assertions", () => {
  let fetchMock;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("assertWorkersHealthy skips workers with no URL and probes the rest", async () => {
    fetchMock.mockResolvedValue(new Response("ok", { status: 200 }));
    const config = {
      target: "production",
      apiBaseUrl: "https://api",
      uploadBaseUrl: "https://up",
      contentBaseUrl: "https://c",
      jobsBaseUrl: undefined,
      streamBaseUrl: "https://s",
      mcpBaseUrl: "https://m",
    };
    await assertWorkersHealthy(config);
    const probed = fetchMock.mock.calls.map(([url]) => String(url));
    expect(probed.some((u) => u.includes("api/healthz"))).toBe(true);
    // jobs was undefined, so it must never be fetched.
    expect(probed.some((u) => u.includes("jobs"))).toBe(false);
  });

  it("assertApexServes throws when the home route is not 200", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 503, headers: { "content-type": "text/html" } }));
    await expect(assertApexServes({ apexBaseUrl: "https://apex" })).rejects.toThrow(/apex \/ returned 503/);
  });

  it("assertApexServes passes when all routes serve expected content-types", async () => {
    fetchMock.mockImplementation((url) => {
      const u = String(url);
      if (u.endsWith("/")) return Promise.resolve(htmlResponse());
      if (u.endsWith("/llms.txt")) return Promise.resolve(htmlResponse("llms", { "content-type": "text/plain" }));
      if (u.endsWith("/agents.md")) return Promise.resolve(htmlResponse("agents", { "content-type": "text/markdown" }));
      if (u.endsWith("/dashboard")) return Promise.resolve(new Response(null, { status: 308 }));
      return Promise.resolve(new Response("?", { status: 404 }));
    });
    await expect(assertApexServes({ apexBaseUrl: "https://apex" })).resolves.toBeUndefined();
  });

  it("assertWebServes requires a 307 sign-in redirect to WorkOS", async () => {
    fetchMock.mockImplementation((url) => {
      const u = String(url);
      if (u.endsWith("/healthz")) return Promise.resolve(htmlResponse("ok"));
      if (u.endsWith("/api/auth/sign-in")) {
        return Promise.resolve(
          new Response(null, {
            status: 307,
            headers: { location: "https://api.workos.com/user_management/authorize?x=1" },
          }),
        );
      }
      return Promise.resolve(new Response("?", { status: 404 }));
    });
    await expect(assertWebServes({ webBaseUrl: "https://web" })).resolves.toBeUndefined();
  });

  it("assertWebServes throws when sign-in does not redirect to WorkOS", async () => {
    fetchMock.mockImplementation((url) => {
      const u = String(url);
      if (u.endsWith("/healthz")) return Promise.resolve(htmlResponse("ok"));
      return Promise.resolve(new Response(null, { status: 307, headers: { location: "https://evil.test" } }));
    });
    await expect(assertWebServes({ webBaseUrl: "https://web" })).rejects.toThrow(/sign-in location/);
  });
});
