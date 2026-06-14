import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import {
  assertPublishOutput,
  ephemeralHostedConfig,
  normalizeEphemeralHostedTarget,
  probeEphemeralPowReady,
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

  it("allows PR smoke to skip exact Artifact URL origin assertion", async () => {
    await expect(
      assertPublishOutput(samplePublishResult("https://agent-paste-web-pr-460.example.workers.dev"), {
        apiBaseUrl: "https://api.example.test",
        contentBaseUrl: "https://content.example.test",
        webBaseUrl: undefined,
        claimWebOrigin: "https://app.preview.agent-paste.sh",
        expectedClaimTokenPrefix: "ap_ct_preview_",
      }),
    ).resolves.toBeUndefined();
  });

  it("checks exact Artifact URL origin when configured", async () => {
    await expect(
      assertPublishOutput(samplePublishResult("https://app.preview.agent-paste.sh.evil"), {
        apiBaseUrl: "https://api.example.test",
        contentBaseUrl: "https://content.example.test",
        webBaseUrl: "https://app.preview.agent-paste.sh",
        claimWebOrigin: "https://app.preview.agent-paste.sh",
        expectedClaimTokenPrefix: "ap_ct_preview_",
      }),
    ).rejects.toThrow(/viewer_url targets web origin/);
  });

  it("checks exact revision content URL origin", async () => {
    await expect(
      assertPublishOutput(
        samplePublishResult("https://app.preview.agent-paste.sh", {
          revision_content_url: "https://content.example.test.evil/v/token/index.html",
        }),
        {
          apiBaseUrl: "https://api.example.test",
          contentBaseUrl: "https://content.example.test",
          webBaseUrl: "https://app.preview.agent-paste.sh",
          claimWebOrigin: "https://app.preview.agent-paste.sh",
          expectedClaimTokenPrefix: "ap_ct_preview_",
        },
      ),
    ).rejects.toThrow(/revision_content_url targets content origin/);
  });
});

describe("probeEphemeralPowReady", () => {
  it("detects pow_required readiness", async () => {
    const server = await startProbeServer({
      status: 401,
      body: {
        error: { code: "pow_required" },
        challenge: { nonce: "n", difficulty: 8, issued_at: new Date().toISOString() },
      },
    });
    try {
      const result = await probeEphemeralPowReady(server.baseUrl);
      expect(result.ready).toBe(true);
      expect(shouldFailHostedEphemeralReadiness(result)).toBe(false);
    } finally {
      await server.close();
    }
  });

  it("skips when PoW secret is missing", async () => {
    const server = await startProbeServer({
      status: 503,
      body: { error: { code: "database_unavailable" } },
    });
    try {
      const result = await probeEphemeralPowReady(server.baseUrl);
      expect(result.ready).toBe(false);
      expect(result.skip).toBe(true);
      expect(result.reason).toContain("EPHEMERAL_POW_SECRET");
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
      const result = await probeEphemeralPowReady(server.baseUrl);
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
      const result = await probeEphemeralPowReady(server.baseUrl);
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
      status: 401,
      body: {
        error: { code: "pow_required" },
        challenge: { nonce: "n", difficulty: 8, issued_at: new Date().toISOString() },
      },
    });
    const baseUrl = server.baseUrl;
    await server.close();

    const result = await probeEphemeralPowReady(baseUrl);
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

function samplePublishResult(artifactOrigin, overrides = {}) {
  const revisionContentUrl = overrides.revision_content_url ?? "https://content.example.test/v/token/index.html";
  return {
    artifact_id: "art_test",
    revision_id: "rev_test",
    viewer_url: `${artifactOrigin}/artifacts/art_test`,
    revision_content_url: revisionContentUrl,
    agent_view_url: "https://api.example.test/v1/public/agent-view/art_test",
    claim_token: "ap_ct_preview_test",
    claim_url: "https://app.preview.agent-paste.sh/claim#ap_ct_preview_test",
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    ...overrides,
  };
}
