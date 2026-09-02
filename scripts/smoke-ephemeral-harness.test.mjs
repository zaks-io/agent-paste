import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import {
  assertContentPolicy,
  assertNoClaimTokenLeakage,
  assertPublishOutput,
  ephemeralHostedConfig,
  normalizeEphemeralHostedTarget,
  probeEphemeralProvisionReady,
  shouldFailHostedEphemeralReadiness,
} from "./smoke-ephemeral-harness.mjs";

describe("smoke-ephemeral-harness", () => {
  it("normalizes hosted ephemeral smoke targets", () => {
    expect(normalizeEphemeralHostedTarget()).toBe("preview");
    expect(normalizeEphemeralHostedTarget("live")).toBe("production");
    expect(normalizeEphemeralHostedTarget("pr")).toBe("pr");
  });

  it("builds preview hosted config defaults", () => {
    const config = ephemeralHostedConfig("preview");
    expect(config.apiBaseUrl).toContain("agent-paste-api-preview");
    expect(config.expectedClaimTokenPrefix).toBe("ap_ct_preview_");
    expect(config.allowHarnessCleanup).toBe(true);
  });

  it("builds production hosted config without harness cleanup", () => {
    const config = ephemeralHostedConfig("production");
    expect(config.apiBaseUrl).toBe("https://api.agent-paste.sh");
    expect(config.harnessSecret).toBeUndefined();
    expect(config.allowHarnessCleanup).toBe(false);
    expect(config.expectedClaimTokenPrefix).toBe("ap_ct_production_");
  });

  it("requires PR URLs for pr target", () => {
    expect(() => ephemeralHostedConfig("pr")).toThrow(/AGENT_PASTE_PR_API_URL/);
  });

  it("accepts a PR-scoped capability hostname for PR smoke", async () => {
    await expect(
      assertPublishOutput(
        samplePublishResult({ url: "https://0123456789abcdef0123456789abcdef-pr-621.agent-paste.link/" }),
        {
          target: "pr",
          claimWebOrigin: "https://app.preview.agent-paste.sh",
          expectedClaimTokenPrefix: "ap_ct_preview_",
          expectedPrNumber: "621",
        },
      ),
    ).resolves.toBeUndefined();
  });

  it("rejects the standing preview capability hostname for PR smoke", async () => {
    await expect(
      assertPublishOutput(samplePublishResult(), {
        target: "pr",
        claimWebOrigin: "https://app.preview.agent-paste.sh",
        expectedClaimTokenPrefix: "ap_ct_preview_",
        expectedPrNumber: "621",
      }),
    ).rejects.toThrow(/url targets pr Artifact host/);
  });

  it("rejects another PR's capability hostname for PR smoke", async () => {
    await expect(
      assertPublishOutput(
        samplePublishResult({ url: "https://0123456789abcdef0123456789abcdef-pr-622.agent-paste.link/" }),
        {
          target: "pr",
          claimWebOrigin: "https://app.preview.agent-paste.sh",
          expectedClaimTokenPrefix: "ap_ct_preview_",
          expectedPrNumber: "621",
        },
      ),
    ).rejects.toThrow(/url targets pr Artifact host/);
  });

  it("accepts the signed content path used by the local harness", async () => {
    await expect(
      assertPublishOutput(
        samplePublishResult({
          url: "http://127.0.0.1:8789/v/signed-content-token/index.html",
          claim_url: "http://127.0.0.1:18999/claim#ap_ct_preview_test",
        }),
        {
          target: "local",
          claimWebOrigin: "http://127.0.0.1:18999",
          expectedClaimTokenPrefix: "ap_ct_preview_",
        },
      ),
    ).resolves.toBeUndefined();
  });

  it("rejects a signed content path for hosted targets", async () => {
    await expect(
      assertPublishOutput(
        samplePublishResult({
          url: "https://0123456789abcdef0123456789abcdef-preview.agent-paste.link/v/token/index.html",
        }),
        {
          target: "preview",
          claimWebOrigin: "https://app.preview.agent-paste.sh",
          expectedClaimTokenPrefix: "ap_ct_preview_",
        },
      ),
    ).rejects.toThrow(/url opens the Artifact root/);
  });

  it("rejects HTTP capability URLs for hosted targets", async () => {
    await expect(
      assertPublishOutput(samplePublishResult({ url: previewArtifactUrl.replace("https:", "http:") }), {
        target: "preview",
        claimWebOrigin: "https://app.preview.agent-paste.sh",
        expectedClaimTokenPrefix: "ap_ct_preview_",
      }),
    ).rejects.toThrow(/hosted url uses HTTPS/);
  });

  it("rejects a lookalike preview capability hostname", async () => {
    await expect(
      assertPublishOutput(
        samplePublishResult({ url: "https://0123456789abcdef0123456789abcdef-preview.agent-paste.link.evil/" }),
        {
          target: "preview",
          claimWebOrigin: "https://app.preview.agent-paste.sh",
          expectedClaimTokenPrefix: "ap_ct_preview_",
        },
      ),
    ).rejects.toThrow(/url targets preview Artifact host/);
  });

  it("rejects a production capability hostname in preview", async () => {
    await expect(
      assertPublishOutput(samplePublishResult({ url: "https://0123456789abcdef0123456789abcdef.agent-paste.link/" }), {
        target: "preview",
        claimWebOrigin: "https://app.preview.agent-paste.sh",
        expectedClaimTokenPrefix: "ap_ct_preview_",
      }),
    ).rejects.toThrow(/url targets preview Artifact host/);
  });

  it("rejects query strings and fragments on Artifact URLs", () => {
    expect(() =>
      assertNoClaimTokenLeakage(samplePublishResult({ url: `${previewArtifactUrl}?token=encoded` }), ""),
    ).toThrow(/no query string/);
    expect(() => assertNoClaimTokenLeakage(samplePublishResult({ url: `${previewArtifactUrl}#fragment` }), "")).toThrow(
      /no fragment/,
    );
  });

  it("rejects a percent-encoded Claim Token in an Artifact path", () => {
    const claimToken = "ap_ct_preview_test";
    const encodedClaimToken = Array.from(
      claimToken,
      (character) => `%${character.codePointAt(0).toString(16).padStart(2, "0")}`,
    ).join("");

    expect(() =>
      assertNoClaimTokenLeakage(
        samplePublishResult({ url: `http://127.0.0.1:8789/v/${encodedClaimToken}/index.html` }),
        "",
      ),
    ).toThrow(/path does not encode Claim Token/);
  });
});

describe("assertContentPolicy", () => {
  it("accepts static content with active behavior blocked", async () => {
    const server = await startContentServer();
    try {
      await expect(assertContentPolicy(server.baseUrl, "ap_ct_preview_secret")).resolves.toBeUndefined();
    } finally {
      await server.close();
    }
  });

  it("rejects redirects before following them", async () => {
    const server = await startContentServer();
    try {
      await expect(assertContentPolicy(`${server.baseUrl}/redirect`, "ap_ct_preview_secret")).rejects.toThrow(
        /returned 302/,
      );
    } finally {
      await server.close();
    }
  });

  it("uses the first duplicate CSP directive like browsers do", async () => {
    const server = await startContentServer();
    try {
      await expect(
        assertContentPolicy(`${server.baseUrl}/duplicate-script-src`, "ap_ct_preview_secret"),
      ).rejects.toThrow(/blocks scripts/);
    } finally {
      await server.close();
    }
  });

  it.each([
    ["missing frame-ancestors", "/missing-frame-ancestors", /content CSP blocks framing/],
    ["permissive frame-ancestors", "/wrong-frame-ancestors", /content CSP blocks framing/],
    ["missing X-Frame-Options", "/missing-x-frame-options", /X-Frame-Options DENY/],
    ["permissive X-Frame-Options", "/wrong-x-frame-options", /X-Frame-Options DENY/],
  ])("rejects %s", async (_label, path, expected) => {
    const server = await startContentServer();
    try {
      await expect(assertContentPolicy(`${server.baseUrl}${path}`, "ap_ct_preview_secret")).rejects.toThrow(expected);
    } finally {
      await server.close();
    }
  });
});

describe("probeEphemeralProvisionReady", () => {
  it("detects provision readiness", async () => {
    const server = await startProbeServer({
      status: 201,
      body: {
        api_key_secret: "ap_pk_preview_secret",
        claim_token: "ap_ct_preview_secret",
      },
    });
    try {
      const result = await probeEphemeralProvisionReady(server.baseUrl);
      expect(result.ready).toBe(true);
      expect(shouldFailHostedEphemeralReadiness(result)).toBe(false);
    } finally {
      await server.close();
    }
  });

  it("treats unhealthy hosted provision readiness as fatal", async () => {
    const server = await startProbeServer({
      status: 503,
      body: { error: { code: "ephemeral_provision_unavailable" } },
    });
    try {
      const result = await probeEphemeralProvisionReady(server.baseUrl);
      expect(result.ready).toBe(false);
      expect(result.skip).toBe(false);
      expect(result.reason).toContain("ephemeral_provision_unavailable");
      expect(shouldFailHostedEphemeralReadiness(result)).toBe(true);
    } finally {
      await server.close();
    }
  });

  it("treats unexpected provision error codes as fatal", async () => {
    const server = await startProbeServer({
      status: 422,
      body: { error: { code: "invalid_request" } },
    });
    try {
      const result = await probeEphemeralProvisionReady(server.baseUrl);
      expect(result.ready).toBe(false);
      expect(result.skip).toBe(false);
      expect(result.reason).toContain("invalid_request");
      expect(shouldFailHostedEphemeralReadiness(result)).toBe(true);
    } finally {
      await server.close();
    }
  });

  it("treats network probe failures as fatal", async () => {
    const server = await startProbeServer({
      status: 201,
      body: {
        api_key_secret: "ap_pk_preview_secret",
        claim_token: "ap_ct_preview_secret",
      },
    });
    const baseUrl = server.baseUrl;
    await server.close();

    const result = await probeEphemeralProvisionReady(baseUrl);
    expect(result.ready).toBe(false);
    expect(result.skip).toBe(false);
    expect(result.reason).toContain("ephemeral provision probe failed");
    expect(shouldFailHostedEphemeralReadiness(result)).toBe(true);
  });
});

function startProbeServer({ status, body }) {
  return new Promise((resolve) => {
    const server = createServer((request, response) => {
      if (request.url === "/v1/ephemeral/provision" && request.method === "POST") {
        response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
        response.end(JSON.stringify(body));
        return;
      }
      response.writeHead(404);
      response.end();
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise((closeResolve) => server.close(closeResolve)),
      });
    });
  });
}

function startContentServer() {
  return new Promise((resolve) => {
    const server = createServer((request, response) => {
      if (request.url === "/redirect") {
        response.writeHead(302, { location: "/" });
        response.end();
        return;
      }

      const path = request.url ?? "/";
      const scriptPolicy = [
        "default-src 'none'",
        "script-src 'none'",
        "connect-src 'none'",
        "worker-src 'none'",
        "frame-src 'none'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
      ].join("; ");
      const effectiveScriptPolicy =
        path === "/duplicate-script-src" ? `script-src https:; ${scriptPolicy}` : scriptPolicy;
      const framePolicy =
        path === "/missing-frame-ancestors"
          ? effectiveScriptPolicy
          : `${effectiveScriptPolicy}; frame-ancestors ${path === "/wrong-frame-ancestors" ? "'self'" : "'none'"}`;
      const headers = {
        "content-type": "text/html; charset=utf-8",
        "content-security-policy": framePolicy,
        "x-robots-tag": "noindex, nofollow",
      };
      if (path !== "/missing-x-frame-options") {
        headers["x-frame-options"] = path === "/wrong-x-frame-options" ? "SAMEORIGIN" : "DENY";
      }
      response.writeHead(200, headers);
      response.end("<!doctype html><title>Agent Paste Ephemeral Smoke</title><h1>Ephemeral Local Smoke</h1>");
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise((closeResolve) => server.close(closeResolve)),
      });
    });
  });
}

const previewArtifactUrl = "https://0123456789abcdef0123456789abcdef-preview.agent-paste.link/";

function samplePublishResult(overrides = {}) {
  return {
    artifact_id: "art_test",
    revision_id: "rev_test",
    url: previewArtifactUrl,
    claim_token: "ap_ct_preview_test",
    claim_url: "https://app.preview.agent-paste.sh/claim#ap_ct_preview_test",
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    ...overrides,
  };
}
