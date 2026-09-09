import { describe, expect, it } from "vitest";
import { type Env, handleMcpApiRequest, handleRequest } from "./index.js";

const mcpSubject = "user_01J5K7Y8G9H0ABCDEFGHJKMNPQ";
const workspaceId = "00000000-0000-4000-8000-000000000001";
const artifactId = "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
const memberActor = {
  type: "member" as const,
  id: "mem_mcp",
  workspace_id: workspaceId,
  email: "user@example.com",
  scopes: ["read", "publish", "admin"] as const,
};

function allowRateLimits(): Pick<Env, "ACTOR_RATE_LIMIT" | "WORKSPACE_BURST_CAP" | "ARTIFACT_RATE_LIMIT"> {
  return {
    ACTOR_RATE_LIMIT: { limit: async () => ({ success: true }) },
    WORKSPACE_BURST_CAP: { limit: async () => ({ success: true }) },
    ARTIFACT_RATE_LIMIT: { limit: async () => ({ success: true }) },
  };
}

function memberDb(overrides: Partial<NonNullable<Env["DB"]>> = {}): NonNullable<Env["DB"]> {
  return {
    async getWhoami() {
      throw new Error("getWhoami should not run in MCP route auth tests");
    },
    async getWebMemberByWorkOsUserId({ workosUserId }) {
      return workosUserId === mcpSubject ? memberActor : null;
    },
    async getWebWorkspace(actor) {
      expect(actor).toEqual(memberActor);
      return { workspace: { id: workspaceId, name: "MCP Workspace" } };
    },
    ...overrides,
  } as NonNullable<Env["DB"]>;
}

describe("API MCP route-boundary auth", () => {
  it("accepts an internal MCP subject at the named service boundary", async () => {
    const response = await handleMcpApiRequest(
      new Request("https://api.test/v1/mcp/whoami"),
      { ...allowRateLimits(), DB: memberDb() },
      mcpSubject,
      "mcp.whoami",
    );

    expect(response.status, await response.clone().text()).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      workspace_member: { id: memberActor.id, email: memberActor.email },
      workspace: { id: workspaceId, name: "MCP Workspace" },
      scopes: ["read", "publish", "admin"],
    });
  });

  it("rejects an MCP bearer sent directly to the public API route", async () => {
    const externallySuppliedOauthBearer = "test-mcp-oauth-token";
    const response = await handleRequest(
      new Request("https://api.test/v1/mcp/whoami", {
        headers: { authorization: `Bearer ${externallySuppliedOauthBearer}` },
      }),
      {
        ...allowRateLimits(),
        AUTH: {
          async verifyApiKey() {
            throw new Error("public API-key verification must not accept an MCP bearer");
          },
        },
        DB: memberDb(),
      },
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "not_authenticated" } });
  });

  it("forbids an internal MCP subject without workspace membership", async () => {
    const response = await handleMcpApiRequest(
      new Request("https://api.test/v1/mcp/whoami"),
      {
        ...allowRateLimits(),
        DB: memberDb({
          async getWebMemberByWorkOsUserId() {
            return null;
          },
        }),
      },
      mcpSubject,
      "mcp.whoami",
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "forbidden" } });
  });

  it("rejects route-id and request-path mismatches before application routing", async () => {
    const response = await handleMcpApiRequest(
      new Request("https://api.test/v1/mcp/whoami"),
      { ...allowRateLimits(), DB: memberDb() },
      mcpSubject,
      "artifacts.list",
    );
    expect(response.status).toBe(404);
  });

  it("preserves API-key access on shared routes", async () => {
    const response = await handleRequest(
      new Request(`https://api.test/v1/artifacts/${artifactId}/revisions`, {
        headers: { authorization: "Bearer ok" },
      }),
      {
        ...allowRateLimits(),
        AUTH: {
          async verifyApiKey(token) {
            return token === "ok"
              ? { type: "api_key", id: "key_1", workspace_id: workspaceId, scopes: ["read"] }
              : null;
          },
        },
        DB: {
          async getWhoami() {
            throw new Error("getWhoami should not run");
          },
          async listRevisions({ actor, artifactId: listedArtifactId }) {
            expect(actor).toMatchObject({ type: "api_key", id: "key_1" });
            expect(listedArtifactId).toBe(artifactId);
            return { artifact_id: artifactId, items: [], page_info: { next_cursor: null, has_more: false } };
          },
        } as NonNullable<Env["DB"]>,
      },
    );
    expect(response.status, await response.clone().text()).toBe(200);
  });

  it("accepts an internal MCP subject on shared routes", async () => {
    const response = await handleMcpApiRequest(
      new Request(`https://api.test/v1/artifacts/${artifactId}/revisions`),
      {
        ...allowRateLimits(),
        DB: {
          ...memberDb(),
          async listRevisions({ actor, artifactId: listedArtifactId }) {
            expect(actor).toEqual(memberActor);
            expect(listedArtifactId).toBe(artifactId);
            return { artifact_id: artifactId, items: [], page_info: { next_cursor: null, has_more: false } };
          },
        } as NonNullable<Env["DB"]>,
      },
      mcpSubject,
      "revisions.list",
    );
    expect(response.status).toBe(200);
  });
});
