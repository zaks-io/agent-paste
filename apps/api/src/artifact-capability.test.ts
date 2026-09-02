import { verifyContentToken } from "@agent-paste/tokens/content";
import { parseContentCapabilityManifest } from "@agent-paste/tokens/content-capability";
import { describe, expect, it, vi } from "vitest";
import { refreshClaimedArtifactCapabilities } from "./artifact-capability.js";

describe("claimed Artifact capability refresh", () => {
  it("rewrites the stable subdomain manifest with claimed ownership and retention", async () => {
    const capabilityId = "0123456789abcdef0123456789abcdef";
    const destinationWorkspaceId = "00000000-0000-4000-8000-000000000001";
    const claimedExpiry = "2099-09-30T00:00:00.000Z";
    const put = vi.fn(async () => ({ etag: "claimed" }));
    const getWebArtifact = vi.fn(async () => ({
      capability_view: {
        workspace_id: destinationWorkspaceId,
        capability_id: capabilityId,
        artifact_id: "art_claimed",
        revision_id: "rev_claimed",
        revision_number: 1,
        artifact_updated_at: "2099-09-01T00:00:00.000Z",
        entrypoint: "index.html",
        expires_at: claimedExpiry,
        files: [
          {
            path: "index.html",
            object_key: `workspaces/${destinationWorkspaceId}/blobs/claimed-index`,
          },
        ],
      },
    }));

    await refreshClaimedArtifactCapabilities(
      { getWebArtifact } as never,
      {
        ARTIFACTS: {
          get: vi.fn(async () => null),
          put,
        } as never,
        CONTENT_CAPABILITY_DOMAIN: "agent-paste.test",
        CONTENT_SIGNING_SECRET: "content-secret",
      },
      {
        type: "member",
        id: "mem_claimed",
        workspace_id: destinationWorkspaceId,
        email: "member@example.test",
        scopes: ["publish", "read", "admin"],
      },
      ["art_claimed"],
    );

    expect(getWebArtifact).toHaveBeenCalledWith(
      expect.objectContaining({ workspace_id: destinationWorkspaceId }),
      "art_claimed",
    );
    expect(put).toHaveBeenCalledTimes(1);
    const manifest = parseContentCapabilityManifest(String(put.mock.calls[0]?.[1]));
    expect(manifest).not.toBeNull();
    const payload = await verifyContentToken(manifest?.signed_token ?? "", "content-secret");
    expect(payload).toMatchObject({
      workspace_id: destinationWorkspaceId,
      artifact_id: "art_claimed",
      revision_id: "rev_claimed",
      script_disabled: false,
      object_keys: {
        "index.html": `workspaces/${destinationWorkspaceId}/blobs/claimed-index`,
      },
      exp: Math.floor(Date.parse(claimedExpiry) / 1000),
    });
    expect(payload).not.toHaveProperty("noindex");
  });

  it("reports every failed refresh and fails the request so it can be retried", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const getWebArtifact = vi.fn(async (_actor, artifactId) =>
      artifactId === "art_missing" ? null : { capability_view: undefined },
    );

    await expect(
      refreshClaimedArtifactCapabilities(
        { getWebArtifact } as never,
        { AGENT_PASTE_ENV: "test" },
        {
          type: "member",
          id: "mem_claimed",
          workspace_id: "00000000-0000-4000-8000-000000000001",
          email: "member@example.test",
          scopes: ["publish", "read", "admin"],
        },
        ["art_missing", "art_present"],
      ),
    ).rejects.toThrow("Failed to refresh 1 claimed Artifact capability manifest(s).");

    expect(getWebArtifact).toHaveBeenCalledTimes(2);
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('"event":"api.claimed_capability_refresh_failed"'),
    );
    consoleError.mockRestore();
  });
});
