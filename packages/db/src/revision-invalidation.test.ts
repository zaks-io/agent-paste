import { describe, expect, it, vi } from "vitest";
import { enqueueRevisionBytePurge } from "./revision-invalidation.js";
import { bundleKeyFor } from "./validation.js";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const artifactId = "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
const revisionId = "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";

describe("revision invalidation", () => {
  it("enqueues revision-scoped and env-scoped prefixes covering the bundle key", async () => {
    const send = vi.fn(async () => ({}));
    const query = vi.fn(async () => ({ rows: [{ id: revisionId }] }));
    const executor = { query, transaction: vi.fn(async (run) => run({ query, transaction: vi.fn() })) };
    await expect(
      enqueueRevisionBytePurge({ AGENT_PASTE_ENV: "preview", BYTE_PURGE_QUEUE: { send } }, executor, {
        workspaceId,
        artifactId,
        revisionId,
        reason: "retention",
      }),
    ).resolves.toBe(true);
    const envScopedPrefix = `env/preview/workspaces/${workspaceId}/artifacts/${artifactId}/revisions/${revisionId}/`;
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        upload_session_id: null,
        prefixes: [`artifacts/${artifactId}/revisions/${revisionId}/`, envScopedPrefix],
      }),
    );
    const bundleKey = bundleKeyFor({ workspaceId, artifactId, revisionId, storageEnv: "preview" });
    expect(bundleKey.startsWith(envScopedPrefix)).toBe(true);
  });

  it("defaults the env segment to dev when AGENT_PASTE_ENV is unset", async () => {
    const send = vi.fn(async () => ({}));
    const query = vi.fn(async () => ({ rows: [{ id: revisionId }] }));
    const executor = { query, transaction: vi.fn(async (run) => run({ query, transaction: vi.fn() })) };
    await enqueueRevisionBytePurge({ BYTE_PURGE_QUEUE: { send } }, executor, {
      workspaceId,
      artifactId,
      revisionId,
      reason: "retention",
    });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        prefixes: [
          `artifacts/${artifactId}/revisions/${revisionId}/`,
          `env/dev/workspaces/${workspaceId}/artifacts/${artifactId}/revisions/${revisionId}/`,
        ],
      }),
    );
  });
});
