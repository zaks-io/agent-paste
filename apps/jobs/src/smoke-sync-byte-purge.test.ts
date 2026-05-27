import { describe, expect, it } from "vitest";
import { processSmokeSyncBytePurge, smokeSyncBytePurgeEnabled } from "./smoke-sync-byte-purge.js";

const artifactId = "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";

describe("smokeSyncBytePurgeEnabled", () => {
  it("enables sync for preview env even without the explicit smoke var", () => {
    expect(smokeSyncBytePurgeEnabled({ AGENT_PASTE_ENV: "preview" })).toBe(true);
  });

  it("enables sync when the explicit smoke var is set", () => {
    expect(smokeSyncBytePurgeEnabled({ AGENT_PASTE_ENV: "production", SMOKE_SYNC_BYTE_PURGE: "true" })).toBe(true);
  });

  it("disables sync for production without the explicit smoke var", () => {
    expect(smokeSyncBytePurgeEnabled({ AGENT_PASTE_ENV: "production" })).toBe(false);
  });
});

describe("processSmokeSyncBytePurge", () => {
  it("deletes the artifact prefix that smoke waits on", async () => {
    const r2Key = `artifacts/${artifactId}/revisions/rev_test/files/index.html`;
    const deleted: string[][] = [];
    const env = {
      AGENT_PASTE_ENV: "preview",
      ARTIFACTS: {
        async list({ prefix }: { prefix: string }) {
          if (prefix === `artifacts/${artifactId}/`) {
            return { objects: [{ key: r2Key }], truncated: false };
          }
          return { objects: [], truncated: false };
        },
        async delete(keys: string[]) {
          deleted.push(keys);
        },
      },
    };

    await expect(
      processSmokeSyncBytePurge(env, {
        type: "byte.purge.v1",
        workspace_id: "00000000-0000-4000-8000-000000000001",
        artifact_id: artifactId,
        revision_id: "rev_test",
        upload_session_id: null,
        prefixes: [`artifacts/${artifactId}/`],
        reason: "deletion",
      }),
    ).resolves.toBe(1);
    expect(deleted).toEqual([[r2Key]]);
    expect(env.SYNC_BYTE_PURGE_DELETED_OBJECTS).toBe(1);
  });
});
