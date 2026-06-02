import { RepositoryError } from "@agent-paste/db";
import { describe, expect, it, vi } from "vitest";
import { getUsagePolicy, mcpWhoami, revokeCurrentApiKey, whoami } from "../src/routes/account.js";
import {
  deleteMemberArtifactRoute,
  listMemberArtifactsRoute,
  updateDisplayMetadataRoute,
} from "../src/routes/member-artifacts.js";
import {
  apiActor,
  apiPrincipal,
  contextFor,
  guardFor,
  memberPrincipal,
  nonePrincipal,
  responseJson,
  workspaceId,
} from "./route-test-helpers.js";

describe("AP-91 account route modules", () => {
  it("serves whoami only for API key principals", async () => {
    const rejected = await whoami(contextFor(), nonePrincipal(), {} as never);
    expect(rejected.status).toBe(401);

    const getWhoami = vi.fn(async (actor) => ({ actor }));
    const ok = await whoami(contextFor(), apiPrincipal(), { getWhoami } as never);
    expect(ok.status).toBe(200);
    expect(getWhoami).toHaveBeenCalledWith(apiActor);
  });

  it("serves MCP whoami for provisioned WorkOS member principals", async () => {
    const rejected = await mcpWhoami(contextFor(), apiPrincipal(), {} as never);
    expect(rejected.status).toBe(401);

    const getWebWorkspace = vi.fn(async () => ({ workspace: { id: workspaceId, name: "Workspace" } }));
    const ok = await mcpWhoami(contextFor(), memberPrincipal({ email: undefined, mcp_scopes: ["read"] }), {
      getWebWorkspace,
    } as never);
    expect(ok.status).toBe(200);
    await expect(responseJson(ok)).resolves.toMatchObject({
      workspace_member: { id: "mem_1", email: "member@example.com" },
      workspace: { id: workspaceId },
      scopes: ["read"],
    });
  });

  it("gets usage policy through API key actors and reports unavailable repositories", async () => {
    const forbidden = await getUsagePolicy(contextFor(), nonePrincipal(), {} as never);
    expect(forbidden.status).toBe(401);

    const unavailable = await getUsagePolicy(contextFor(), apiPrincipal(), {} as never);
    expect(unavailable.status).toBe(503);

    const getUsagePolicyFn = vi.fn(async () => ({ file_count_cap: 100 }));
    const ok = await getUsagePolicy(contextFor(), apiPrincipal(), { getUsagePolicy: getUsagePolicyFn } as never);
    expect(ok.status).toBe(200);
    expect(getUsagePolicyFn).toHaveBeenCalledWith(apiActor);
  });

  it("revokes current API keys and maps missing key state to not_authenticated", async () => {
    const forbidden = await revokeCurrentApiKey(contextFor(), nonePrincipal(), {} as never);
    expect(forbidden.status).toBe(401);

    const unavailable = await revokeCurrentApiKey(contextFor(), apiPrincipal(), {} as never);
    expect(unavailable.status).toBe(503);

    const revokeCurrentApiKeyFn = vi.fn(async () => {
      throw new RepositoryError("current_api_key_not_found");
    });
    const missing = await revokeCurrentApiKey(contextFor(), apiPrincipal(), {
      revokeCurrentApiKey: revokeCurrentApiKeyFn,
    } as never);
    expect(missing.status).toBe(401);

    revokeCurrentApiKeyFn.mockResolvedValueOnce({ revoked_at: "2026-01-01T00:00:00.000Z" });
    const ok = await revokeCurrentApiKey(contextFor(), apiPrincipal(), {
      revokeCurrentApiKey: revokeCurrentApiKeyFn,
    } as never);
    expect(ok.status).toBe(200);
  });
});

describe("AP-91 member artifact route modules", () => {
  it("lists member artifacts with pagination and cursor error mapping", async () => {
    const rejected = await listMemberArtifactsRoute(contextFor(), nonePrincipal(), {} as never);
    expect(rejected.status).toBe(401);

    const invalidLimit = await listMemberArtifactsRoute(
      contextFor({ url: "https://api.test/v1/artifacts?limit=0" }),
      apiPrincipal(),
      {} as never,
    );
    expect(invalidLimit.status).toBe(400);

    const listMemberArtifacts = vi.fn(async () => ({ items: [] }));
    const ok = await listMemberArtifactsRoute(
      contextFor({ url: "https://api.test/v1/artifacts?limit=2&cursor=next" }),
      apiPrincipal(),
      { listMemberArtifacts } as never,
    );
    expect(ok.status).toBe(200);
    expect(listMemberArtifacts).toHaveBeenCalledWith(apiActor, { limit: 2, cursor: "next" });

    listMemberArtifacts.mockRejectedValueOnce(new RepositoryError("invalid_cursor"));
    const invalidCursor = await listMemberArtifactsRoute(contextFor(), apiPrincipal(), {
      listMemberArtifacts,
    } as never);
    expect(invalidCursor.status).toBe(400);
  });

  it("deletes member artifacts with idempotency fallback and no replay side effects", async () => {
    const rejected = await deleteMemberArtifactRoute(contextFor(), nonePrincipal(), {} as never, {});
    expect(rejected.status).toBe(401);

    const peekWorkspaceCommandReplay = vi.fn(async () => null);
    const deleteMemberArtifact = vi.fn(async () => ({
      workspace_id: workspaceId,
      artifact_id: "art_1",
      revision_id: null,
      deleted_at: "2026-01-01T00:00:00.000Z",
    }));
    const ok = await deleteMemberArtifactRoute(
      contextFor({ params: { artifact_id: "art_1" } }),
      apiPrincipal(),
      { peekWorkspaceCommandReplay, deleteMemberArtifact } as never,
      {},
    );
    expect(ok.status).toBe(200);
    expect(peekWorkspaceCommandReplay).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: "mcp-delete:art_1", operation: "artifact.delete" }),
    );
    await expect(responseJson(ok)).resolves.toEqual({
      artifact_id: "art_1",
      deleted_at: "2026-01-01T00:00:00.000Z",
    });
  });

  it("updates display metadata and maps repository validation failures", async () => {
    const rejected = await updateDisplayMetadataRoute(
      contextFor(),
      nonePrincipal(),
      {} as never,
      guardFor({ title: "New" }),
    );
    expect(rejected.status).toBe(401);

    const updateArtifactDisplayMetadata = vi.fn(async () => ({ artifact_id: "art_1", title: "New" }));
    const ok = await updateDisplayMetadataRoute(
      contextFor({ params: { artifact_id: "art_1" } }),
      apiPrincipal(),
      { updateArtifactDisplayMetadata } as never,
      guardFor({ title: "New" }),
    );
    expect(ok.status).toBe(200);
    expect(updateArtifactDisplayMetadata).toHaveBeenCalledWith(
      expect.objectContaining({ artifactId: "art_1", title: "New" }),
    );

    updateArtifactDisplayMetadata.mockRejectedValueOnce(new RepositoryError("artifact_not_found"));
    const missing = await updateDisplayMetadataRoute(
      contextFor(),
      apiPrincipal(),
      { updateArtifactDisplayMetadata } as never,
      guardFor(),
    );
    expect(missing.status).toBe(404);

    updateArtifactDisplayMetadata.mockRejectedValueOnce(new RepositoryError("invalid_request"));
    const invalid = await updateDisplayMetadataRoute(
      contextFor(),
      apiPrincipal(),
      { updateArtifactDisplayMetadata } as never,
      guardFor(),
    );
    expect(invalid.status).toBe(400);
  });
});
