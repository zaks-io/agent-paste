import { describe, expect, it } from "vitest";
import { MCP_TOOL_NAMES, mcpSmokeConfig, normalizeMcpSmokeTarget } from "./smoke-mcp-harness.mjs";

describe("smoke-mcp-harness", () => {
  it("normalizes hosted smoke targets", () => {
    expect(normalizeMcpSmokeTarget()).toBe("local");
    expect(normalizeMcpSmokeTarget("local")).toBe("local");
    expect(normalizeMcpSmokeTarget("live")).toBe("production");
    expect(normalizeMcpSmokeTarget("preview")).toBe("preview");
  });

  it("builds preview hosted config with auth server metadata", () => {
    const config = mcpSmokeConfig("preview");
    expect(config.mcpBaseUrl).toContain("mcp.preview.agent-paste.sh");
    expect(config.resource).toContain("mcp.preview.agent-paste.sh");
    expect(config.audience).toBe("https://mcp.preview.agent-paste.sh/");
    expect(config.authorizationServers[0]).toContain("authkit.app");
  });

  it("lists the twelve ADR 0061 tool names", () => {
    expect(MCP_TOOL_NAMES).toHaveLength(12);
    expect(MCP_TOOL_NAMES).toContain("whoami");
    expect(MCP_TOOL_NAMES).toContain("publish_artifact");
  });
});
