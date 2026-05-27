import { describe, expect, it, vi } from "vitest";
import * as generateZip from "../bundle/generate-zip.js";
import { handleBundleGenerateBatch, handleBundleGenerateDlqBatch } from "./bundle-generate.js";

const workspaceId = "00000000-0000-4000-8000-000000000000";
const artifactId = "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
const revisionId = "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";

function makeDb(overrides: {
  revision?: { status: string; artifact_status: string; bundle_status: string } | null;
  files?: Array<{ path: string; r2_key: string }>;
}) {
  return {
    query: async (sql: string) => {
      if (sql.includes("from revisions r")) {
        return { rows: overrides.revision ? [overrides.revision] : [] };
      }
      if (sql.includes("from artifact_files")) {
        return { rows: overrides.files ?? [] };
      }
      return { rows: [] };
    },
    transaction: async (fn: (tx: { query: (sql: string) => Promise<{ rows: unknown[] }> }) => Promise<unknown>) =>
      fn({
        query: async (sql: string) => {
          if (sql.includes("insert into idempotency_records")) {
            return { rows: [{ workspace_id: workspaceId }] };
          }
          return { rows: [] };
        },
      }),
  };
}

describe("handleBundleGenerateBatch integration", () => {
  it("short-circuits when bundle status is already ready", async () => {
    const ack = vi.fn();
    const put = vi.fn();
    await handleBundleGenerateBatch(
      [
        {
          body: {
            type: "bundle.generate.v1",
            workspace_id: workspaceId,
            artifact_id: artifactId,
            revision_id: revisionId,
            requested_at: "2026-05-20T00:00:00.000Z",
            reason: "publish",
          },
          ack,
          retry: vi.fn(),
        },
      ],
      {
        AGENT_PASTE_ENV: "dev",
        DB: makeDb({
          revision: { status: "published", artifact_status: "active", bundle_status: "ready" },
        }),
        ARTIFACTS: { list: vi.fn(), delete: vi.fn(), get: vi.fn(), put },
      },
    );
    expect(ack).toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it("marks failed when zip exceeds bundle size cap", async () => {
    const ack = vi.fn();
    const updates: string[] = [];
    const overCapZip = vi.spyOn(generateZip, "buildRevisionZip").mockReturnValue(new Uint8Array(26 * 1024 * 1024 + 1));
    try {
      await handleBundleGenerateBatch(
        [
          {
            body: {
              type: "bundle.generate.v1",
              workspace_id: workspaceId,
              artifact_id: artifactId,
              revision_id: revisionId,
              requested_at: "2026-05-20T00:00:00.000Z",
              reason: "publish",
            },
            ack,
            retry: vi.fn(),
          },
        ],
        {
          AGENT_PASTE_ENV: "dev",
          DB: {
            query: async (sql: string) => {
              if (sql.includes("from revisions r")) {
                return {
                  rows: [{ status: "published", artifact_status: "active", bundle_status: "pending" }],
                };
              }
              if (sql.includes("from artifact_files")) {
                return {
                  rows: [{ path: "big.bin", r2_key: "artifacts/art/rev/files/big.bin" }],
                };
              }
              return { rows: [] };
            },
            transaction: async (fn) =>
              fn({
                query: async (sql: string) => {
                  if (sql.includes("bundle_status = 'failed'")) {
                    updates.push(sql);
                  }
                  if (sql.includes("insert into idempotency_records")) {
                    return { rows: [{ workspace_id: workspaceId }] };
                  }
                  return { rows: [] };
                },
              }),
          },
          ARTIFACTS: {
            list: vi.fn(),
            delete: vi.fn(),
            get: async () => ({ body: new Uint8Array([1, 2, 3]) }),
            put: vi.fn(),
          },
        },
      );
      expect(ack).toHaveBeenCalled();
      expect(updates.some((sql) => sql.includes("bundle_status = 'failed'"))).toBe(true);
    } finally {
      overCapZip.mockRestore();
    }
  });

  it("writes bundle.zip under the ADR 0021 key prefix", async () => {
    const ack = vi.fn();
    const put = vi.fn(async () => {});
    const bundleKey = `env/dev/workspaces/${workspaceId}/artifacts/${artifactId}/revisions/${revisionId}/bundle.zip`;
    await handleBundleGenerateBatch(
      [
        {
          body: {
            type: "bundle.generate.v1",
            workspace_id: workspaceId,
            artifact_id: artifactId,
            revision_id: revisionId,
            requested_at: "2026-05-20T00:00:00.000Z",
            reason: "publish",
          },
          ack,
          retry: vi.fn(),
        },
      ],
      {
        AGENT_PASTE_ENV: "dev",
        DB: {
          query: async (sql: string) => {
            if (sql.includes("from revisions r")) {
              return {
                rows: [{ status: "published", artifact_status: "active", bundle_status: "pending" }],
              };
            }
            if (sql.includes("from artifact_files")) {
              return {
                rows: [
                  { path: "index.html", r2_key: `artifacts/${artifactId}/revisions/${revisionId}/files/index.html` },
                ],
              };
            }
            return { rows: [] };
          },
          transaction: async (fn) =>
            fn({
              query: async (sql: string) => {
                if (sql.includes("insert into idempotency_records")) {
                  return { rows: [{ workspace_id: workspaceId }] };
                }
                return { rows: [] };
              },
            }),
        },
        ARTIFACTS: {
          list: vi.fn(),
          delete: vi.fn(),
          get: async () => ({ body: new TextEncoder().encode("<html></html>") }),
          put,
        },
      },
    );
    expect(put).toHaveBeenCalledWith(bundleKey, expect.any(Uint8Array), {
      httpMetadata: { contentType: "application/zip" },
    });
    expect(ack).toHaveBeenCalled();
  });

  it("acks when the revision row is missing", async () => {
    const ack = vi.fn();
    const retry = vi.fn();
    await handleBundleGenerateBatch(
      [
        {
          body: {
            type: "bundle.generate.v1",
            workspace_id: workspaceId,
            artifact_id: artifactId,
            revision_id: revisionId,
            requested_at: "2026-05-20T00:00:00.000Z",
            reason: "publish",
          },
          ack,
          retry,
        },
      ],
      {
        AGENT_PASTE_ENV: "dev",
        DB: makeDb({ revision: null }),
        ARTIFACTS: { list: vi.fn(), delete: vi.fn(), get: vi.fn(), put: vi.fn() },
      },
    );
    expect(ack).toHaveBeenCalled();
    expect(retry).not.toHaveBeenCalled();
  });

  it("retries when the artifacts bucket binding is incomplete", async () => {
    const ack = vi.fn();
    const retry = vi.fn();
    await handleBundleGenerateBatch(
      [
        {
          body: {
            type: "bundle.generate.v1",
            workspace_id: workspaceId,
            artifact_id: artifactId,
            revision_id: revisionId,
            requested_at: "2026-05-20T00:00:00.000Z",
            reason: "publish",
          },
          ack,
          retry,
        },
      ],
      {
        AGENT_PASTE_ENV: "dev",
        DB: makeDb({
          revision: { status: "published", artifact_status: "active", bundle_status: "pending" },
          files: [{ path: "index.html", r2_key: "k" }],
        }),
        ARTIFACTS: { list: vi.fn(), delete: vi.fn(), get: vi.fn() },
      },
    );
    expect(retry).toHaveBeenCalled();
    expect(ack).not.toHaveBeenCalled();
  });

  it("retries when an R2 object body is missing", async () => {
    const ack = vi.fn();
    const retry = vi.fn();
    await handleBundleGenerateBatch(
      [
        {
          body: {
            type: "bundle.generate.v1",
            workspace_id: workspaceId,
            artifact_id: artifactId,
            revision_id: revisionId,
            requested_at: "2026-05-20T00:00:00.000Z",
            reason: "publish",
          },
          ack,
          retry,
        },
      ],
      {
        AGENT_PASTE_ENV: "dev",
        DB: makeDb({
          revision: { status: "published", artifact_status: "active", bundle_status: "pending" },
          files: [{ path: "index.html", r2_key: "k" }],
        }),
        ARTIFACTS: {
          list: vi.fn(),
          delete: vi.fn(),
          get: async () => ({ body: null }),
          put: vi.fn(),
        },
      },
    );
    expect(retry).toHaveBeenCalled();
    expect(ack).not.toHaveBeenCalled();
  });

  it("reads ReadableStream R2 bodies and uses live storage env segment", async () => {
    const ack = vi.fn();
    const put = vi.fn(async () => {});
    const bundleKey = `env/live/workspaces/${workspaceId}/artifacts/${artifactId}/revisions/${revisionId}/bundle.zip`;
    const streamBody = new Response("streamed").body;
    await handleBundleGenerateBatch(
      [
        {
          body: {
            type: "bundle.generate.v1",
            workspace_id: workspaceId,
            artifact_id: artifactId,
            revision_id: revisionId,
            requested_at: "2026-05-20T00:00:00.000Z",
            reason: "publish",
          },
          ack,
          retry: vi.fn(),
        },
      ],
      {
        AGENT_PASTE_ENV: "production",
        DB: makeDb({
          revision: { status: "published", artifact_status: "active", bundle_status: "pending" },
          files: [{ path: "index.html", r2_key: "k" }],
        }),
        ARTIFACTS: {
          list: vi.fn(),
          delete: vi.fn(),
          get: async () => ({ body: streamBody }),
          put,
        },
      },
    );
    expect(put).toHaveBeenCalledWith(bundleKey, expect.any(Uint8Array), {
      httpMetadata: { contentType: "application/zip" },
    });
    expect(ack).toHaveBeenCalled();
  });
});

describe("handleBundleGenerateDlqBatch", () => {
  it("acks invalid DLQ payloads without retrying", async () => {
    const ack = vi.fn();
    const retry = vi.fn();
    await handleBundleGenerateDlqBatch([{ body: { type: "bundle.generate.v1" }, ack, retry }], {
      DB: makeDb({ revision: null }),
      ARTIFACTS: { list: vi.fn(), delete: vi.fn(), get: vi.fn(), put: vi.fn() },
    });
    expect(ack).toHaveBeenCalled();
    expect(retry).not.toHaveBeenCalled();
  });

  it("retries when marking bundle failed throws", async () => {
    const ack = vi.fn();
    const retry = vi.fn();
    await handleBundleGenerateDlqBatch(
      [
        {
          body: {
            type: "bundle.generate.v1",
            workspace_id: workspaceId,
            artifact_id: artifactId,
            revision_id: revisionId,
            requested_at: "2026-05-20T00:00:00.000Z",
            reason: "publish",
          },
          ack,
          retry,
        },
      ],
      {
        DB: {
          query: vi.fn(async () => ({ rows: [] })),
          transaction: async () => {
            throw new Error("db down");
          },
        },
        ARTIFACTS: { list: vi.fn(), delete: vi.fn(), get: vi.fn(), put: vi.fn() },
      },
    );
    expect(retry).toHaveBeenCalled();
    expect(ack).not.toHaveBeenCalled();
  });
});
