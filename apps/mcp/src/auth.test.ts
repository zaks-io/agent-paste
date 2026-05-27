import { describe, expect, it } from "vitest";
import {
  createTestMcpBearerAuth,
  createUnconfiguredMcpBearerAuth,
  parseBearerToken,
  rejectMissingBearer,
} from "./auth.js";

describe("MCP bearer auth hooks", () => {
  it("parses bearer tokens case-insensitively", () => {
    expect(parseBearerToken("Bearer token-1")).toBe("token-1");
    expect(parseBearerToken("bearer token-2")).toBe("token-2");
    expect(parseBearerToken("Basic x")).toBeNull();
  });

  it("rejects WorkOS session-style tokens at the MCP surface", () => {
    const verify = createTestMcpBearerAuth({ ok: { tokenSub: "u1", scopes: ["read"] } });
    const response = verify({ authorizationHeader: "Bearer wos_session_abc" });
    expect(response).toEqual({
      ok: false,
      code: "invalid_token",
      message: "workos_access_token is not accepted at the MCP surface",
    });
  });

  it("returns not-configured for opaque bearer tokens until JWT verification ships", () => {
    const verify = createUnconfiguredMcpBearerAuth();
    expect(verify({ authorizationHeader: "Bearer opaque-oauth-token" })).toEqual({
      ok: false,
      code: "invalid_token",
      message: "mcp_oauth_verifier_not_configured",
    });
    expect(verify({ authorizationHeader: null })).toEqual(rejectMissingBearer());
  });
});
