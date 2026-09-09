import type { RouteId } from "@agent-paste/contracts";
import { describe, expect, it } from "vitest";
import { isAllowedMcpServiceRequest } from "./mcp-service-route.js";

const allowed = new Set<RouteId>(["mcp.whoami", "artifacts.fileContent"]);

describe("internal MCP service routes", () => {
  it("accepts only an allowlisted route with its contracted method and path", () => {
    expect(
      isAllowedMcpServiceRequest(
        new Request("https://internal/v1/mcp/whoami", { method: "GET" }),
        "mcp.whoami",
        "api",
        allowed,
      ),
    ).toBe(true);
    expect(
      isAllowedMcpServiceRequest(
        new Request("https://internal/v1/artifacts/art_1/file-content?path=index.md", { method: "GET" }),
        "artifacts.fileContent",
        "api",
        allowed,
      ),
    ).toBe(true);
  });

  it("rejects route-id, method, app, and path mismatches", () => {
    expect(
      isAllowedMcpServiceRequest(
        new Request("https://internal/v1/artifacts", { method: "GET" }),
        "artifacts.list",
        "api",
        allowed,
      ),
    ).toBe(false);
    expect(
      isAllowedMcpServiceRequest(
        new Request("https://internal/v1/mcp/whoami", { method: "POST" }),
        "mcp.whoami",
        "api",
        allowed,
      ),
    ).toBe(false);
    expect(
      isAllowedMcpServiceRequest(
        new Request("https://internal/v1/mcp/whoami", { method: "GET" }),
        "mcp.whoami",
        "upload",
        allowed,
      ),
    ).toBe(false);
    expect(
      isAllowedMcpServiceRequest(
        new Request("https://internal/v1/artifacts/art_1/revisions", { method: "GET" }),
        "artifacts.fileContent",
        "api",
        allowed,
      ),
    ).toBe(false);
  });
});
