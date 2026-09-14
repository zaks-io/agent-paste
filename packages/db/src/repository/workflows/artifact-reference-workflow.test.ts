import { describe, expect, it } from "vitest";
import { LocalRepository } from "../../local-repository.js";
import type { ApiActor, Artifact } from "../../types.js";

const artifactId = "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
const capabilityId = "01234-56789-abcde-fghjd";
const now = "2026-09-14T00:00:00.000Z";

function actor(workspaceId: string): ApiActor {
  return { type: "api_key", id: `key_${workspaceId}`, workspace_id: workspaceId, scopes: ["read", "publish"] };
}

function artifact(workspaceId: string, overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: artifactId,
    capability_id: capabilityId,
    workspace_id: workspaceId,
    revision_id: "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
    status: "active",
    title: "Plan",
    entrypoint: "index.html",
    file_count: 1,
    size_bytes: 12,
    expires_at: "2026-10-14T00:00:00.000Z",
    pinned_at: null,
    created_by_type: "api_key",
    created_by_id: "key_owner",
    access_link_lockdown_at: null,
    deleted_at: null,
    delete_reason: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

describe("resolveArtifactReference", () => {
  it("resolves an Artifact URL within the actor workspace and accepts deep links", async () => {
    const repo = new LocalRepository({ apiKeyPepper: "pepper" });
    repo.artifacts.set(artifactId, artifact("workspace_a"));

    await expect(
      repo.resolveArtifactReference({
        actor: actor("workspace_a"),
        reference: `https://${capabilityId}-preview.agent-paste.link/docs/plan.html?mode=review#risks`,
        capabilityDomain: "agent-paste.link",
        capabilityHostSuffix: "-preview",
      }),
    ).resolves.toBe(artifactId);
  });

  it("does not resolve the same capability from another workspace", async () => {
    const repo = new LocalRepository({ apiKeyPepper: "pepper" });
    repo.artifacts.set(artifactId, artifact("workspace_a"));

    await expect(
      repo.resolveArtifactReference({
        actor: actor("workspace_b"),
        reference: capabilityId,
        capabilityDomain: "agent-paste.link",
        capabilityHostSuffix: "-preview",
      }),
    ).resolves.toBeNull();
  });

  it.each([
    capabilityId.toUpperCase(),
    `${capabilityId.toUpperCase()}-PREVIEW`,
  ])("resolves the current environment's bare capability label: %s", async (reference) => {
    const repo = new LocalRepository({ apiKeyPepper: "pepper" });
    repo.artifacts.set(artifactId, artifact("workspace_a"));
    await expect(
      repo.resolveArtifactReference({
        actor: actor("workspace_a"),
        reference,
        capabilityDomain: "agent-paste.link",
        capabilityHostSuffix: "-preview",
      }),
    ).resolves.toBe(artifactId);
  });

  it("resolves legacy hexadecimal capability labels case-insensitively", async () => {
    const repo = new LocalRepository({ apiKeyPepper: "pepper" });
    const legacyArtifactId = artifactId.replace(/.$/u, "A");
    const legacyCapabilityId = "abcdef0123456789abcdef0123456789";
    repo.artifacts.set(
      legacyArtifactId,
      artifact("workspace_a", { id: legacyArtifactId, capability_id: legacyCapabilityId }),
    );

    await expect(
      repo.resolveArtifactReference({
        actor: actor("workspace_a"),
        reference: `${legacyCapabilityId.toUpperCase()}-PREVIEW`,
        capabilityDomain: "agent-paste.link",
        capabilityHostSuffix: "-preview",
      }),
    ).resolves.toBe(legacyArtifactId);
  });

  it.each([
    [`https://${capabilityId}.agent-paste.link/`, "preview rejects a production host"],
    [`https://${capabilityId}-preview.agent-paste.link:443/`, "rejects an explicit port"],
    [`https://user@${capabilityId}-preview.agent-paste.link/`, "rejects credentials"],
    [`https:\\${capabilityId}-preview.agent-paste.link/`, "rejects backslash normalization"],
    [`https://${capabilityId}-preview.example.test/`, "rejects a foreign domain"],
    [`${capabilityId}-production`, "rejects a mismatched bare environment suffix"],
    [`${capabilityId.slice(0, -1)}e`, "rejects a checksum typo"],
  ])("returns null for invalid or wrong-environment references: %s", async (reference) => {
    const repo = new LocalRepository({ apiKeyPepper: "pepper" });
    repo.artifacts.set(artifactId, artifact("workspace_a"));
    await expect(
      repo.resolveArtifactReference({
        actor: actor("workspace_a"),
        reference,
        capabilityDomain: "agent-paste.link",
        capabilityHostSuffix: "-preview",
      }),
    ).resolves.toBeNull();
  });

  it("keeps resolving the same canonical ID after the published revision changes", async () => {
    const repo = new LocalRepository({ apiKeyPepper: "pepper" });
    repo.artifacts.set(artifactId, artifact("workspace_a"));
    const input = {
      actor: actor("workspace_a"),
      reference: `https://${capabilityId}.agent-paste.link/`,
      capabilityDomain: "agent-paste.link",
    };

    await expect(repo.resolveArtifactReference(input)).resolves.toBe(artifactId);
    const stored = repo.artifacts.get(artifactId);
    if (!stored) {
      throw new Error("expected seeded artifact");
    }
    stored.revision_id = "rev_01HZY7Q8X9Y2S3T4V5W6X7Y90";
    await expect(repo.resolveArtifactReference(input)).resolves.toBe(artifactId);
  });

  it("keeps accepting canonical Artifact IDs without capability hosting configuration", async () => {
    const repo = new LocalRepository({ apiKeyPepper: "pepper" });
    await expect(repo.resolveArtifactReference({ actor: actor("workspace_a"), reference: artifactId })).resolves.toBe(
      artifactId,
    );
  });

  it("requires capability domain configuration for a bare capability label", async () => {
    const repo = new LocalRepository({ apiKeyPepper: "pepper" });
    repo.artifacts.set(artifactId, artifact("workspace_a"));
    await expect(
      repo.resolveArtifactReference({ actor: actor("workspace_a"), reference: capabilityId }),
    ).resolves.toBeNull();
  });
});
