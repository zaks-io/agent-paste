import { describe, expect, it, vi } from "vitest";
import { runPostCommitArtifactDeletionInvalidation } from "./deletion-invalidation.js";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const artifactId = "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
const revisionId = "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
describe("API deletion invalidation boundary", () => {
  it("writes denylist and enqueues purge", async () => {
    const puts: Array<{ key: string; value: string }> = [];
    const send = vi.fn(async () => ({}));
    const revisions = new Map([[revisionId, {}]]);
    const result = await runPostCommitArtifactDeletionInvalidation(
      {
        DENYLIST: {
          put: async (key, value) => {
            puts.push({ key, value });
          },
        },
        BYTE_PURGE_QUEUE: { send },
        LOCAL_MVP_REPOSITORY: { revisions },
      },
      {
        workspaceId,
        artifactId,
        revisionId,
      },
    );
    expect(result.denylistWritten).toBe(true);
    expect(result.enqueued).toBe(true);
    expect(puts[0]?.key).toBe(`ad:${artifactId}`);
    expect(send).toHaveBeenCalled();
    expect(revisions.get(revisionId)?.bytes_purge_enqueued_at).toEqual(expect.any(String));
  });

  it("retries public-read invalidation after a prior failure", async () => {
    const put = vi
      .fn()
      .mockRejectedValueOnce(new Error("KV unavailable"))
      .mockRejectedValueOnce(new Error("KV unavailable"))
      .mockRejectedValueOnce(new Error("KV unavailable"))
      .mockResolvedValue(undefined);
    const env = { DENYLIST: { put } };
    const input = { workspaceId, artifactId, revisionId: null };

    await expect(runPostCommitArtifactDeletionInvalidation(env, input)).resolves.toMatchObject({
      denylistWritten: false,
    });
    await expect(runPostCommitArtifactDeletionInvalidation(env, input)).resolves.toMatchObject({
      denylistWritten: true,
    });
    expect(put).toHaveBeenCalledTimes(4);
  });
});
