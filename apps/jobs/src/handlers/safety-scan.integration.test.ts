import { describe, expect, it, vi } from "vitest";
import { handleSafetyScanBatch } from "./safety-scan.js";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const artifactId = "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
const revisionId = "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";

describe("handleSafetyScanBatch", () => {
  it("runs the built-in scanner and replaces warnings through runCommand", async () => {
    const warningInserts: unknown[][] = [];
    const auditInserts: unknown[][] = [];
    const tx = {
      query: vi.fn(async (sql: string, params?: readonly unknown[]) => {
        if (sql.includes("insert into idempotency_records")) {
          return { rows: [{ workspace_id: workspaceId }] };
        }
        if (sql.includes("from safety_warnings")) {
          return { rows: [] };
        }
        if (sql.includes("insert into safety_warnings")) {
          warningInserts.push(params ?? []);
        }
        if (sql.includes("insert into operation_events")) {
          auditInserts.push(params ?? []);
        }
        return { rows: [] };
      }),
      transaction: vi.fn(),
    };
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("from revisions r")) {
          return { rows: [{ status: "published", artifact_status: "active" }] };
        }
        if (sql.includes("from artifact_files")) {
          return {
            rows: [
              {
                path: "index.html",
                r2_key: "objects/index.html",
                served_content_type: "text/html; charset=utf-8",
              },
            ],
          };
        }
        return { rows: [] };
      }),
      transaction: vi.fn(async (run) => run(tx)),
    };
    const ack = vi.fn();

    await handleSafetyScanBatch(
      [
        {
          body: {
            type: "safety.scan.v1",
            workspace_id: workspaceId,
            artifact_id: artifactId,
            revision_id: revisionId,
            scanner_id: "builtin_content",
            scanner_version: "1",
            requested_at: "2026-05-20T00:00:00.000Z",
          },
          ack,
          retry: vi.fn(),
        },
      ],
      {
        DB: db,
        ARTIFACTS: {
          list: vi.fn(),
          delete: vi.fn(),
          get: async () => ({ body: new TextEncoder().encode(`<form><input type="password"></form>`) }),
        },
      },
    );

    expect(ack).toHaveBeenCalled();
    expect(warningInserts).toHaveLength(1);
    expect(warningInserts[0]).toEqual(
      expect.arrayContaining([
        workspaceId,
        artifactId,
        revisionId,
        "builtin_content",
        "1",
        "credential_collection_form",
        "warning",
        "file",
        "index.html",
      ]),
    );
    expect(auditInserts).toHaveLength(1);
    expect(auditInserts[0]?.[4]).toBe("safety_warnings.replaced");
  });
});
