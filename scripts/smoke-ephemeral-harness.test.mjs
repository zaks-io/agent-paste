import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import {
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
      expect(result.reason).toContain("EPHEMERAL_POW_SECRET");
    } finally {
      await server.close();
    }
  });

  it("treats unhealthy PR provision readiness as fatal", async () => {
    const server = await startProbeServer({
      status: 503,
      body: { error: { code: "ephemeral_provision_unavailable" } },
    });
    try {
      const result = await probeEphemeralPowReady(server.baseUrl);
      expect(result.ready).toBe(false);
      expect(result.reason).toContain("ephemeral_provision_unavailable");
      expect(shouldFailHostedEphemeralReadiness("pr", result)).toBe(true);
      expect(shouldFailHostedEphemeralReadiness("preview", result)).toBe(false);
    } finally {
      await server.close();
    }
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
