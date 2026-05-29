import { describe, expect, it, vi } from "vitest";
import {
  peekAdminArtifactDeleteReplay,
  peekMemberArtifactDeleteReplay,
  runPostCommitArtifactDeletionInvalidation,
} from "./deletion-invalidation.js";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const artifactId = "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
const revisionId = "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
const actor = { type: "platform" as const, id: "smoke" };

describe("API deletion invalidation boundary", () => {
  it("skips side effects on idempotency replay", async () => {
    const put = vi.fn();
    const send = vi.fn();
    const result = await runPostCommitArtifactDeletionInvalidation(
      {
        DENYLIST: { put },
        BYTE_PURGE_QUEUE: { send },
        LOCAL_MVP_REPOSITORY: { revisions: new Map([[revisionId, {}]]) },
      },
      {
        actor,
        idempotencyKey: "smoke-delete:art",
        workspaceId,
        artifactId,
        revisionId,
      },
      { isReplay: true },
    );
    expect(result).toMatchObject({
      replaySkipped: true,
      denylistWritten: false,
      enqueued: false,
      deleted_r2_objects: 0,
    });
    expect(put).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("writes denylist and enqueues purge when not a replay", async () => {
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
        actor,
        idempotencyKey: "smoke-delete:art",
        workspaceId,
        artifactId,
        revisionId,
      },
      { isReplay: false },
    );
    expect(result.replaySkipped).toBe(false);
    expect(result.denylistWritten).toBe(true);
    expect(result.enqueued).toBe(true);
    expect(puts[0]?.key).toBe(`ad:${artifactId}`);
    expect(send).toHaveBeenCalled();
    expect(revisions.get(revisionId)?.bytes_purge_enqueued_at).toEqual(expect.any(String));
  });

  it("detects completed member delete replays via peek", async () => {
    const executor = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("from idempotency_records")) {
          return { rows: [{ status: "completed", result_json: {}, created_at: "2026-01-01T00:00:00.000Z" }] };
        }
        return { rows: [] };
      }),
      transaction: vi.fn(async (run) => run(executor)),
    };
    await expect(
      peekMemberArtifactDeleteReplay(executor, {
        actor: { type: "member", id: "mem_01J5K7Y8G9H0ABCDEFGHJKMNPQ", workspace_id: workspaceId },
        workspaceId,
        idempotencyKey: "mcp-delete:art",
      }),
    ).resolves.toBe(true);
  });

  it("detects completed admin delete replays via peek", async () => {
    const executor = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("from idempotency_records")) {
          return { rows: [{ status: "completed", result_json: {}, created_at: "2026-01-01T00:00:00.000Z" }] };
        }
        return { rows: [] };
      }),
      transaction: vi.fn(async (run) => run(executor)),
    };
    await expect(
      peekAdminArtifactDeleteReplay(executor, {
        actor,
        workspaceId,
        idempotencyKey: "smoke-delete:art",
      }),
    ).resolves.toBe(true);
  });
});
