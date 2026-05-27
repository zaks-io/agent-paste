import { describe, expect, it, vi } from "vitest";
import { inspectPurgeRecoveryArtifact } from "./purge-recovery-eligibility.js";

const artifactId = "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
const workspaceId = "00000000-0000-4000-8000-000000000001";
const revisionId = "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";

function mockExecutor(rows: Record<string, unknown>[]) {
  return {
    query: vi.fn(async () => ({ rows })),
    transaction: vi.fn(),
  };
}

describe("inspectPurgeRecoveryArtifact", () => {
  it("reports row_missing when the artifact is absent", async () => {
    await expect(inspectPurgeRecoveryArtifact(mockExecutor([]), artifactId)).resolves.toMatchObject({
      eligibility: "row_missing",
      artifact_found: false,
      status: null,
    });
  });

  it("reports missing_revision_id when revision_id is null", async () => {
    await expect(
      inspectPurgeRecoveryArtifact(
        mockExecutor([
          {
            id: artifactId,
            workspace_id: workspaceId,
            revision_id: null,
            status: "deleted",
            deleted_at: "2026-05-27T00:00:00.000Z",
          },
        ]),
        artifactId,
      ),
    ).resolves.toMatchObject({
      eligibility: "missing_revision_id",
      artifact_found: false,
      status: "deleted",
    });
  });

  it("reports not_deleted_or_expired when status is still active", async () => {
    await expect(
      inspectPurgeRecoveryArtifact(
        mockExecutor([
          {
            id: artifactId,
            workspace_id: workspaceId,
            revision_id: revisionId,
            status: "active",
            deleted_at: null,
          },
        ]),
        artifactId,
      ),
    ).resolves.toMatchObject({
      eligibility: "not_deleted_or_expired",
      artifact_found: false,
      status: "active",
    });
  });

  it("returns eligible artifact details for deleted rows", async () => {
    await expect(
      inspectPurgeRecoveryArtifact(
        mockExecutor([
          {
            id: artifactId,
            workspace_id: workspaceId,
            revision_id: revisionId,
            status: "deleted",
            deleted_at: "2026-05-27T00:00:00.000Z",
          },
        ]),
        artifactId,
      ),
    ).resolves.toMatchObject({
      eligibility: "eligible",
      artifact_found: true,
      artifact: {
        id: artifactId,
        workspace_id: workspaceId,
        revision_id: revisionId,
      },
    });
  });
});
