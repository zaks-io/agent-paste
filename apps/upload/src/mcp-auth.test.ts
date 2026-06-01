import { authenticateMcpBearer, mcpVerifyOptions } from "@agent-paste/auth";
import { MCP_RESOURCE_INDICATOR } from "@agent-paste/contracts";
import { describe, expect, it } from "vitest";

describe("upload worker MCP auth wiring", () => {
  it("uses shared MCP bearer primitives from @agent-paste/auth", () => {
    expect(authenticateMcpBearer).toBeTypeOf("function");
    expect(mcpVerifyOptions({ WORKOS_API_KEY: "sk_test" })).toMatchObject({
      apiKey: "sk_test",
      clientId: MCP_RESOURCE_INDICATOR,
      skipClientIdClaimVerification: true,
    });
  });
});
