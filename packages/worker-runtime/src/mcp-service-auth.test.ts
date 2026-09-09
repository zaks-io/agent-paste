import { describe, expect, it } from "vitest";
import { getInternalMcpSubject, withInternalMcpSubject } from "./mcp-service-auth.js";

describe("internal MCP service identity", () => {
  it("stores the subject out of band without mutating the Worker environment", () => {
    const env = { marker: "base" };
    const internal = withInternalMcpSubject(env, " user_01 ");

    expect(internal).not.toBe(env);
    expect(internal.marker).toBe("base");
    expect(getInternalMcpSubject(internal)).toBe("user_01");
    expect(getInternalMcpSubject(env)).toBeNull();
    expect(Object.keys(internal)).not.toContain("internalMcpSubject");
  });

  it.each(["", " ", "user\nforged", "x".repeat(256)])("rejects invalid subjects", (subject) => {
    expect(() => withInternalMcpSubject({}, subject)).toThrow("invalid_internal_mcp_subject");
  });
});
