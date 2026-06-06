import { encryptArtifactBytes } from "@agent-paste/storage";
import { describe, expect, it, vi } from "vitest";
import * as generateZip from "../bundle/generate-zip.js";
import { createMockSqlExecutor } from "../test-helpers/mock-sql-executor.js";
import { handleBundleGenerateBatch, handleBundleGenerateDlqBatch } from "./bundle-generate.js";

const artifactBytesEncryptionEnv = {
  ARTIFACT_BYTES_ENCRYPTION_KEY: "test-artifact-bytes-encryption-key",
};

async function encryptedRevisionFile(input: {
  workspaceId: string;
  artifactId: string;
  revisionId: string;
  path: string;
  plaintext: string;
}) {
  const encrypted = await encryptArtifactBytes({
    plaintext: new TextEncoder().encode(input.plaintext),
    rootSecret: artifactBytesEncryptionEnv.ARTIFACT_BYTES_ENCRYPTION_KEY,
    kid: 1,
    context: {
      workspaceId: input.workspaceId,
      artifactId: input.artifactId,
      revisionId: input.revisionId,
      normalizedPath: input.path,
    },
  });
  return { body: encrypted.ciphertext, customMetadata: encrypted.customMetadata };
}

const workspaceId = "00000000-0000-4000-8000-000000000000";
const artifactId = "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
const revisionId = "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";

function makeDb(overrides: {
  revision?: { status: string; artifact_status: string; bundle_status: string } | null;
  files?: Array<{ path: string; r2_key: string }>;
  plan?: "free" | "pro";
  txQuery?: (sql: string) => Promise<{ rows: unknown[] }>;
}) {
  const outerQuery = async (sql: string) => {
    if (sql.includes("from workspaces")) {
      return { rows: [{ plan: overrides.plan ?? "free" }] };
    }
    if (sql.includes("from revisions r")) {
      return { rows: overrides.revision ? [overrides.revision] : [] };
    }
    if (sql.includes("from artifact_files")) {
      return { rows: overrides.files ?? [] };
    }
    return { rows: [] };
  };
  const txQuery =
    overrides.txQuery ??
    (async (sql: string) => {
      if (sql.includes("insert into idempotency_records")) {
        return { rows: [{ workspace_id: workspaceId }] };
      }
      return { rows: [] };
    });
  return createMockSqlExecutor(outerQuery, txQuery);
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
        ...artifactBytesEncryptionEnv,
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

  it("marks failed when zip is above the free cap with billing off", async () => {
    const ack = vi.fn();
    const readyUpdates: string[] = [];
    const failedUpdates: string[] = [];
    const overLegacyCapZip = vi
      .spyOn(generateZip, "buildRevisionZip")
      .mockReturnValue(new Uint8Array(26 * 1024 * 1024));
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
          ...artifactBytesEncryptionEnv,
          AGENT_PASTE_ENV: "dev",
          DB: makeDb({
            revision: { status: "published", artifact_status: "active", bundle_status: "pending" },
            files: [
              {
                path: "big.bin",
                r2_key: `artifacts/${artifactId}/revisions/${revisionId}/files/big.bin`,
              },
            ],
            txQuery: async (sql: string) => {
              if (sql.includes("bundle_status = 'ready'")) {
                readyUpdates.push(sql);
              }
              if (sql.includes("bundle_status = 'failed'")) {
                failedUpdates.push(sql);
              }
              if (sql.includes("insert into idempotency_records")) {
                return { rows: [{ workspace_id: workspaceId }] };
              }
              return { rows: [] };
            },
          }),
          ARTIFACTS: {
            list: vi.fn(),
            delete: vi.fn(),
            get: async () =>
              encryptedRevisionFile({
                workspaceId,
                artifactId,
                revisionId,
                path: "big.bin",
                plaintext: "\u0001\u0002\u0003",
              }),
            put: vi.fn(async () => {}),
          },
        },
      );
      expect(ack).toHaveBeenCalled();
      expect(readyUpdates).toHaveLength(0);
      expect(failedUpdates.some((sql) => sql.includes("bundle_status = 'failed'"))).toBe(true);
    } finally {
      overLegacyCapZip.mockRestore();
    }
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
          ...artifactBytesEncryptionEnv,
          AGENT_PASTE_ENV: "dev",
          BILLING_ENABLED: "true",
          DB: makeDb({
            revision: { status: "published", artifact_status: "active", bundle_status: "pending" },
            files: [
              {
                path: "big.bin",
                r2_key: `artifacts/${artifactId}/revisions/${revisionId}/files/big.bin`,
              },
            ],
            txQuery: async (sql: string) => {
              if (sql.includes("bundle_status = 'failed'")) {
                updates.push(sql);
              }
              if (sql.includes("insert into idempotency_records")) {
                return { rows: [{ workspace_id: workspaceId }] };
              }
              return { rows: [] };
            },
          }),
          ARTIFACTS: {
            list: vi.fn(),
            delete: vi.fn(),
            get: async () =>
              encryptedRevisionFile({
                workspaceId,
                artifactId,
                revisionId,
                path: "big.bin",
                plaintext: "\u0001\u0002\u0003",
              }),
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
        ...artifactBytesEncryptionEnv,
        AGENT_PASTE_ENV: "dev",
        DB: makeDb({
          revision: { status: "published", artifact_status: "active", bundle_status: "pending" },
          files: [{ path: "index.html", r2_key: `artifacts/${artifactId}/revisions/${revisionId}/files/index.html` }],
        }),
        ARTIFACTS: {
          list: vi.fn(),
          delete: vi.fn(),
          get: async () =>
            encryptedRevisionFile({
              workspaceId,
              artifactId,
              revisionId,
              path: "index.html",
              plaintext: "<html></html>",
            }),
          put,
        },
      },
    );
    expect(put).toHaveBeenCalledWith(
      bundleKey,
      expect.any(Uint8Array),
      expect.objectContaining({
        httpMetadata: { contentType: "application/octet-stream" },
        customMetadata: expect.objectContaining({ enc_alg: "aes-256-gcm", enc_kid: "1" }),
      }),
    );
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
        ...artifactBytesEncryptionEnv,
        AGENT_PASTE_ENV: "production",
        DB: makeDb({
          revision: { status: "published", artifact_status: "active", bundle_status: "pending" },
          files: [
            {
              path: "index.html",
              r2_key: `artifacts/${artifactId}/revisions/${revisionId}/files/index.html`,
            },
          ],
        }),
        ARTIFACTS: {
          list: vi.fn(),
          delete: vi.fn(),
          get: async () => {
            const encrypted = await encryptedRevisionFile({
              workspaceId,
              artifactId,
              revisionId,
              path: "index.html",
              plaintext: "streamed",
            });
            return { body: new Blob([encrypted.body]).stream(), customMetadata: encrypted.customMetadata };
          },
          put,
        },
      },
    );
    expect(put).toHaveBeenCalledWith(
      bundleKey,
      expect.any(Uint8Array),
      expect.objectContaining({
        httpMetadata: { contentType: "application/octet-stream" },
        customMetadata: expect.objectContaining({ enc_alg: "aes-256-gcm" }),
      }),
    );
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
        DB: createMockSqlExecutor(
          vi.fn(async () => ({ rows: [] })),
          async () => {
            throw new Error("db down");
          },
        ),
        ARTIFACTS: { list: vi.fn(), delete: vi.fn(), get: vi.fn(), put: vi.fn() },
      },
    );
    expect(retry).toHaveBeenCalled();
    expect(ack).not.toHaveBeenCalled();
  });
});
