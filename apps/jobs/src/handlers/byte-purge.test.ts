import { seedEncryptedRevisionFile } from "@agent-paste/storage/test-helpers/encrypted-artifact-fixture";
import * as Sentry from "@sentry/cloudflare";
import { describe, expect, it, vi } from "vitest";
import type { Env, QueueMessage } from "../env.js";
import * as opLog from "../op-log.js";
import { handleBytePurgeBatch } from "./byte-purge.js";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const artifactId = "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
const revisionId = "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
const envScopedPrefix = `env/live/workspaces/${workspaceId}/artifacts/${artifactId}/revisions/${revisionId}/`;

describe("handleBytePurgeBatch", () => {
  it("isolates real SDK traces while preserving retry, error status, and acknowledgement", async () => {
    const traceA = "00112233445566778899aabbccddeeff";
    const traceB = "ffeeddccbbaa99887766554433221100";
    const parent = "1122334455667788";
    const failed = queueMessage({ prefixes: ["artifacts/other/"] });
    const succeeded = queueMessage({ prefixes: [`artifacts/${artifactId}/`] });
    const messages = [failed, succeeded].map((message, index) => ({
      ...message,
      body: {
        ...(message.body as object),
        trace_context: { "sentry-trace": `${index === 0 ? traceA : traceB}-${parent}-1` },
      },
    }));
    const failedRetry = vi.fn(() => {
      const span = Sentry.getActiveSpan();
      if (!span) throw new Error("active_span_missing");
      expect(Sentry.spanToJSON(span)).toMatchObject({
        trace_id: traceA,
        parent_span_id: parent,
        status: "internal_error",
      });
    });
    const failedMessage = messages[0];
    if (!failedMessage) throw new Error("failed_message_missing");
    failedMessage.retry = failedRetry;
    const pending: Promise<unknown>[] = [];
    const worker = Sentry.withSentry(
      () => ({
        dsn: "https://public@example.ingest.sentry.io/1",
        tracesSampleRate: 1,
        defaultIntegrations: [],
        skipOpenTelemetrySetup: true,
        transport: () => ({ send: async () => ({ statusCode: 200 }), flush: async () => true }),
      }),
      {
        async fetch() {
          await handleBytePurgeBatch(messages, {
            ARTIFACTS: {
              async list() {
                const span = Sentry.getActiveSpan();
                if (!span) throw new Error("active_span_missing");
                expect(Sentry.spanToJSON(span)).toMatchObject({ trace_id: traceB, parent_span_id: parent });
                return { objects: [], truncated: false };
              },
              delete: async () => {},
            },
          });
          return new Response("ok");
        },
      },
    );
    await worker.fetch(
      new Request("https://jobs.test/consume"),
      {},
      {
        waitUntil: (promise: Promise<unknown>) => {
          pending.push(promise);
        },
        passThroughOnException: () => {},
      },
    );
    await Promise.all(pending);
    expect(failedRetry).toHaveBeenCalledOnce();
    expect(failed.ack).not.toHaveBeenCalled();
    expect(succeeded.ack).toHaveBeenCalledOnce();
    expect(succeeded.retry).not.toHaveBeenCalled();
  });
  it("deletes the exact capability manifest with the artifact bytes", async () => {
    const capabilityId = "00112233445566778899aabbccddeeff";
    const capabilityKey = `content-capabilities/v1/${capabilityId}.json`;
    const deleted: string[][] = [];
    const env: Env = {
      ARTIFACTS: {
        async list() {
          return { objects: [], truncated: false };
        },
        async delete(keys) {
          deleted.push(keys);
        },
      },
    };
    const message = queueMessage({ prefixes: [`artifacts/${artifactId}/`], capabilityId });

    await handleBytePurgeBatch([message], env);

    expect(deleted).toContainEqual([capabilityKey]);
    expect(message.ack).toHaveBeenCalled();
  });

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

describe("artifact bytes encrypt→store→read fidelity", () => {
  it("purges env-scoped encrypted bundle keys emitted for byte purge", async () => {
    const bundleKey = `${envScopedPrefix}bundle.zip`;
    const fixture = await seedEncryptedRevisionFile({
      workspaceId,
      artifactId,
      revisionId,
      path: "bundle.zip",
      plaintext: "zip-fidelity",
    });
    const deleted: string[][] = [];
    const env: Env = {
      AGENT_PASTE_ENV: "production",
      ARTIFACTS: {
        async list({ prefix }) {
          if (prefix === `artifacts/${artifactId}/`) {
            return { objects: [], truncated: false };
          }
          if (prefix === envScopedPrefix) {
            return {
              objects: [
                {
                  key: bundleKey,
                  customMetadata: fixture.customMetadata,
                },
              ],
              truncated: false,
            };
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

    expect(deleted).toEqual([[bundleKey]]);
    expect(fixture.body).not.toEqual(new TextEncoder().encode("zip-fidelity"));
    expect(message.ack).toHaveBeenCalled();
  });
});

function queueMessage(overrides: { prefixes: string[]; capabilityId?: string }): QueueMessage {
  return {
    body: {
      type: "byte.purge.v1",
      workspace_id: workspaceId,
      artifact_id: artifactId,
      revision_id: revisionId,
      upload_session_id: null,
      capability_id: overrides.capabilityId ?? null,
      prefixes: overrides.prefixes,
      reason: "deletion",
    },
    ack: vi.fn(),
    retry: vi.fn(),
  };
}
