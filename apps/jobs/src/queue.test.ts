import { describe, expect, it, vi } from "vitest";
import { QUEUE_BUNDLE_GENERATE_DLQ, QUEUE_BYTE_PURGE } from "./constants.js";
import { handleQueueBatch, normalizeQueueName } from "./queue.js";
import { createTransactionalSqlExecutor } from "./test-helpers/sql-executor.js";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const artifactId = "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
const revisionId = "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";

describe("normalizeQueueName", () => {
  it("strips shared preview and production suffixes", () => {
    expect(normalizeQueueName("byte-purge-preview")).toBe(QUEUE_BYTE_PURGE);
    expect(normalizeQueueName("byte-purge-production")).toBe(QUEUE_BYTE_PURGE);
    expect(normalizeQueueName("bundle-generate-dlq-preview")).toBe(QUEUE_BUNDLE_GENERATE_DLQ);
  });

  it("strips PR-scoped preview suffixes", () => {
    expect(normalizeQueueName("byte-purge-preview-pr-100")).toBe(QUEUE_BYTE_PURGE);
    expect(normalizeQueueName("byte-purge-dlq-preview-pr-100")).toBe("byte-purge-dlq");
    expect(normalizeQueueName("bundle-generate-dlq-preview-pr-100")).toBe(QUEUE_BUNDLE_GENERATE_DLQ);
  });
});

describe("PR-scoped preview queue routing", () => {
  it("routes byte-purge-preview-pr-100 to the byte purge handler", async () => {
    const deleted: string[][] = [];
    const ack = vi.fn();
    await handleQueueBatch(
      {
        queue: "byte-purge-preview-pr-100",
        messages: [
          {
            body: {
              type: "byte.purge.v1",
              workspace_id: workspaceId,
              artifact_id: artifactId,
              revision_id: revisionId,
              upload_session_id: null,
              prefixes: [`artifacts/${artifactId}/`],
              reason: "deletion",
            },
            ack,
            retry: vi.fn(),
          },
        ],
      },
      {
        ARTIFACTS: {
          async list() {
            return { objects: [{ key: `artifacts/${artifactId}/file.txt` }], truncated: false };
          },
          async delete(keys) {
            deleted.push(keys);
          },
        },
      },
    );
    expect(deleted).toEqual([[`artifacts/${artifactId}/file.txt`]]);
    expect(ack).toHaveBeenCalled();
  });

  it("routes bundle-generate-dlq-preview-pr-100 to the DLQ handler", async () => {
    const updates: unknown[] = [];
    const executor = createTransactionalSqlExecutor(async (sql: string) => {
      if (sql.includes("insert into idempotency_records")) {
        return { rows: [{ workspace_id: workspaceId }] };
      }
      if (sql.includes("update revisions")) {
        updates.push(sql);
      }
      return { rows: [] };
    });
    const ack = vi.fn();
    await handleQueueBatch(
      {
        queue: "bundle-generate-dlq-preview-pr-100",
        messages: [
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
      },
      { DB: executor },
    );
    expect(updates.some((sql) => typeof sql === "string" && sql.includes("bundle_status = 'failed'"))).toBe(true);
    expect(ack).toHaveBeenCalled();
  });
});
