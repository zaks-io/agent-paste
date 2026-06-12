import { describe, expect, it, vi } from "vitest";
import type { Env, QueueMessage } from "../env.js";
import * as opLog from "../op-log.js";
import { handleBytePurgeBatch } from "./byte-purge.js";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const artifactId = "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
const revisionId = "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
const envScopedPrefix = `env/live/workspaces/${workspaceId}/artifacts/${artifactId}/revisions/${revisionId}/`;

describe("handleBytePurgeBatch", () => {
  it("deletes only prefixes scoped to the target artifact", async () => {
    const deleted: string[][] = [];
    const env: Env = {
      AGENT_PASTE_ENV: "production",
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

  it("deletes env-scoped bundle prefixes alongside artifact-scoped file prefixes", async () => {
    const deleted: string[][] = [];
    const bundleKey = `${envScopedPrefix}bundle.zip`;
    const env: Env = {
      AGENT_PASTE_ENV: "production",
      ARTIFACTS: {
        async list({ prefix }) {
          if (prefix === `artifacts/${artifactId}/`) {
            return {
              objects: [{ key: `artifacts/${artifactId}/revisions/${revisionId}/files/index.html` }],
              truncated: false,
            };
          }
          if (prefix === envScopedPrefix) {
            return { objects: [{ key: bundleKey }], truncated: false };
          }
          return { objects: [], truncated: false };
        },
        async delete(keys) {
          deleted.push(keys);
        },
      },
    };
    const message = queueMessage({
      prefixes: [`artifacts/${artifactId}/`, envScopedPrefix],
    });

    await handleBytePurgeBatch([message], env);

    expect(deleted).toEqual([[`artifacts/${artifactId}/revisions/${revisionId}/files/index.html`], [bundleKey]]);
    expect(message.ack).toHaveBeenCalled();
    expect(message.retry).not.toHaveBeenCalled();
  });

  it("accepts env-scoped prefixes whose env segment matches the worker env", async () => {
    const previewPrefix = `env/preview/workspaces/${workspaceId}/artifacts/${artifactId}/`;
    const deleted: string[][] = [];
    const env: Env = {
      AGENT_PASTE_ENV: "preview",
      ARTIFACTS: {
        async list({ prefix }) {
          expect(prefix).toBe(previewPrefix);
          return { objects: [{ key: `${previewPrefix}bundle.zip` }], truncated: false };
        },
        async delete(keys) {
          deleted.push(keys);
        },
      },
    };
    const message = queueMessage({ prefixes: [previewPrefix] });

    await handleBytePurgeBatch([message], env);

    expect(deleted).toEqual([[`${previewPrefix}bundle.zip`]]);
    expect(message.ack).toHaveBeenCalled();
    expect(message.retry).not.toHaveBeenCalled();
  });

  it("retries and logs when an env-scoped prefix targets a foreign env segment", async () => {
    const logSpy = vi.spyOn(opLog, "logOpError");
    const foreignEnvPrefix = `env/preview/workspaces/${workspaceId}/artifacts/${artifactId}/`;
    const env: Env = {
      AGENT_PASTE_ENV: "production",
      ARTIFACTS: {
        list: vi.fn(async () => ({ objects: [], truncated: false })),
        delete: vi.fn(),
      },
    };
    const message = queueMessage({ prefixes: [foreignEnvPrefix] });

    await handleBytePurgeBatch([message], env);

    expect(env.ARTIFACTS?.list).not.toHaveBeenCalled();
    expect(env.ARTIFACTS?.delete).not.toHaveBeenCalled();
    expect(message.ack).not.toHaveBeenCalled();
    expect(message.retry).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith("queue.byte_purge.prefix_env_mismatch", {
      artifact_id: artifactId,
      revision_id: revisionId,
      prefix: foreignEnvPrefix,
      prefix_env: "preview",
      expected_env: "live",
    });
    expect(logSpy).toHaveBeenCalledWith("queue.byte_purge.failed", {
      error: "byte_purge_prefix_env_mismatch",
    });
    logSpy.mockRestore();
  });

  it("retries without listing when any prefix escapes the artifact scope", async () => {
    const env: Env = {
      AGENT_PASTE_ENV: "production",
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
    {
      name: "env-scoped prefix for another artifact",
      prefixes: [`env/live/workspaces/${workspaceId}/artifacts/art_other/`],
    },
    {
      name: "env-scoped prefix for another workspace",
      prefixes: [`env/live/workspaces/00000000-0000-4000-8000-000000000002/artifacts/${artifactId}/`],
    },
    {
      name: "env-scoped prefix missing artifact trailing slash",
      prefixes: [`env/live/workspaces/${workspaceId}/artifacts/${artifactId}`],
    },
  ])("retries without listing for $name", async ({ prefixes }) => {
    const env: Env = {
      AGENT_PASTE_ENV: "production",
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
      workspace_id: workspaceId,
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
