import { describe, expect, it, vi } from "vitest";
import type { Env, QueueMessage } from "../env.js";
import { handleBytePurgeBatch } from "./byte-purge.js";

const artifactId = "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
const revisionId = "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";

describe("handleBytePurgeBatch", () => {
  it("deletes only prefixes scoped to the target artifact", async () => {
    const deleted: string[][] = [];
    const env: Env = {
      ARTIFACTS: {
        async list(options) {
          expect(options.prefix).toBe(`artifacts/${artifactId}/`);
          return { objects: [{ key: `artifacts/${artifactId}/index.html` }], truncated: false };
        },
        async delete(keys) {
          deleted.push(keys);
        },
      },
    };
    const message = queueMessage({
      prefixes: [`artifacts/${artifactId}/`],
    });

    await handleBytePurgeBatch([message], env);

    expect(deleted).toEqual([[`artifacts/${artifactId}/index.html`]]);
    expect(message.ack).toHaveBeenCalled();
    expect(message.retry).not.toHaveBeenCalled();
  });

  it("retries without listing when any prefix escapes the artifact scope", async () => {
    const env: Env = {
      ARTIFACTS: {
        list: vi.fn(async () => ({ objects: [], truncated: false })),
        delete: vi.fn(),
      },
    };
    const message = queueMessage({
      prefixes: [`artifacts/${artifactId}/`, "artifacts/other_artifact/"],
    });

    await handleBytePurgeBatch([message], env);

    expect(env.ARTIFACTS?.list).not.toHaveBeenCalled();
    expect(env.ARTIFACTS?.delete).not.toHaveBeenCalled();
    expect(message.ack).not.toHaveBeenCalled();
    expect(message.retry).toHaveBeenCalled();
  });

  it.each([
    { name: "empty prefixes", prefixes: [] },
    { name: "artifact prefix missing trailing slash", prefixes: [`artifacts/${artifactId}`] },
    { name: "non-artifact prefix", prefixes: ["env/dev/workspaces/ws_1/"] },
    { name: "all prefixes out of scope", prefixes: ["artifacts/other_artifact/"] },
  ])("retries without listing for $name", async ({ prefixes }) => {
    const env: Env = {
      ARTIFACTS: {
        list: vi.fn(async () => ({ objects: [], truncated: false })),
        delete: vi.fn(),
      },
    };
    const message = queueMessage({ prefixes });

    await handleBytePurgeBatch([message], env);

    expect(env.ARTIFACTS?.list).not.toHaveBeenCalled();
    expect(env.ARTIFACTS?.delete).not.toHaveBeenCalled();
    expect(message.ack).not.toHaveBeenCalled();
    expect(message.retry).toHaveBeenCalled();
  });
});

function queueMessage(overrides: { prefixes: string[] }): QueueMessage {
  return {
    body: {
      type: "byte.purge.v1",
      workspace_id: "00000000-0000-4000-8000-000000000001",
      artifact_id: artifactId,
      revision_id: revisionId,
      upload_session_id: null,
      prefixes: overrides.prefixes,
      reason: "deletion",
    },
    ack: vi.fn(),
    retry: vi.fn(),
  };
}
