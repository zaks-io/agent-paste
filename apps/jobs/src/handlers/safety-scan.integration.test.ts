import { verifyAgentViewToken } from "@agent-paste/tokens/agent-view";
import { describe, expect, it, vi } from "vitest";
import { handleSafetyScanBatch } from "./safety-scan.js";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const artifactId = "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
const revisionId = "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
const encoder = new TextEncoder();
const awsAccessKeyId = "AKIA" + "ABCDEFGHIJKLMNOP";
const privateKeyMarker = "-----BEGIN " + "PRIVATE KEY-----";

function safetyScanBody() {
  return {
    type: "safety.scan.v1",
    workspace_id: workspaceId,
    artifact_id: artifactId,
    revision_id: revisionId,
    scanner_id: "builtin_content",
    scanner_version: "1",
    requested_at: "2026-05-20T00:00:00.000Z",
  };
}

describe("handleSafetyScanBatch", () => {
  it("fails before reading messages when the database binding is missing", async () => {
    await expect(handleSafetyScanBatch([], {})).rejects.toThrow("database_unavailable");
  });

  it("acks messages for revisions that no longer exist", async () => {
    const ack = vi.fn();
    const retry = vi.fn();

    await handleSafetyScanBatch([{ body: safetyScanBody(), ack, retry }], {
      DB: {
        query: vi.fn(async () => ({ rows: [] })),
        transaction: vi.fn(),
      },
    });

    expect(ack).toHaveBeenCalledOnce();
    expect(retry).not.toHaveBeenCalled();
  });

  it("retries active revisions when the artifact bucket binding is missing", async () => {
    const ack = vi.fn();
    const retry = vi.fn();

    await handleSafetyScanBatch([{ body: safetyScanBody(), ack, retry }], {
      DB: {
        query: vi.fn(async () => ({ rows: [{ status: "published", artifact_status: "active" }] })),
        transaction: vi.fn(),
      },
    });

    expect(ack).not.toHaveBeenCalled();
    expect(retry).toHaveBeenCalledOnce();
  });

  it("acks retained or deleted revisions without scanning R2", async () => {
    const ack = vi.fn();
    const get = vi.fn();

    await handleSafetyScanBatch([{ body: safetyScanBody(), ack, retry: vi.fn() }], {
      DB: {
        query: vi.fn(async () => ({ rows: [{ status: "retained", artifact_status: "active" }] })),
        transaction: vi.fn(),
      },
      ARTIFACTS: { list: vi.fn(), delete: vi.fn(), get },
    });

    expect(ack).toHaveBeenCalledOnce();
    expect(get).not.toHaveBeenCalled();
  });

  it("retries when a revision file is missing from R2", async () => {
    const retry = vi.fn();

    await handleSafetyScanBatch([{ body: safetyScanBody(), ack: vi.fn(), retry }], {
      DB: {
        query: vi.fn(async (sql: string) => {
          if (sql.includes("from revisions r")) {
            return { rows: [{ status: "published", artifact_status: "active" }] };
          }
          if (sql.includes("from artifact_files")) {
            return {
              rows: [{ path: "missing.txt", r2_key: "objects/missing.txt", served_content_type: "text/plain" }],
            };
          }
          return { rows: [] };
        }),
        transaction: vi.fn(),
      },
      ARTIFACTS: { list: vi.fn(), delete: vi.fn(), get: vi.fn(async () => null) },
    });

    expect(retry).toHaveBeenCalledOnce();
  });

  it("retries when an R2 object body shape is unsupported", async () => {
    const retry = vi.fn();

    await handleSafetyScanBatch([{ body: safetyScanBody(), ack: vi.fn(), retry }], {
      DB: {
        query: vi.fn(async (sql: string) => {
          if (sql.includes("from revisions r")) {
            return { rows: [{ status: "published", artifact_status: "active" }] };
          }
          if (sql.includes("from artifact_files")) {
            return {
              rows: [{ path: "unknown.txt", r2_key: "objects/unknown.txt", served_content_type: "text/plain" }],
            };
          }
          return { rows: [] };
        }),
        transaction: vi.fn(),
      },
      ARTIFACTS: { list: vi.fn(), delete: vi.fn(), get: vi.fn(async () => ({ body: {} as ReadableStream })) },
    });

    expect(retry).toHaveBeenCalledOnce();
  });

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
            ...safetyScanBody(),
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

  it("tracks added, removed, and unchanged warning deltas across R2 body shapes", async () => {
    const warningInserts: unknown[][] = [];
    const auditInserts: unknown[][] = [];
    const tx = {
      query: vi.fn(async (sql: string, params?: readonly unknown[]) => {
        if (sql.includes("insert into idempotency_records")) {
          return { rows: [{ workspace_id: workspaceId }] };
        }
        if (sql.includes("from safety_warnings")) {
          return {
            rows: [
              {
                code: "cloud_secret_identifier",
                severity: "warning",
                scope: "file",
                file_path: "aws.txt",
                message: "This revision appears to include a cloud credential identifier.",
              },
              {
                code: "obsolete_warning",
                severity: "info",
                scope: "file",
                file_path: "old.txt",
                message: "Old warning.",
              },
            ],
          };
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
              { path: "aws.txt", r2_key: "objects/aws.txt", served_content_type: "text/plain" },
              { path: "key.txt", r2_key: "objects/key.txt", served_content_type: "text/plain" },
              { path: "empty.txt", r2_key: "objects/empty.txt", served_content_type: "text/plain" },
              { path: "stream.txt", r2_key: "objects/stream.txt", served_content_type: "text/plain" },
            ],
          };
        }
        return { rows: [] };
      }),
      transaction: vi.fn(async (run) => run(tx)),
    };

    await handleSafetyScanBatch([{ body: safetyScanBody(), ack: vi.fn(), retry: vi.fn() }], {
      DB: db,
      ARTIFACTS: {
        list: vi.fn(),
        delete: vi.fn(),
        get: vi.fn(async (key: string) => {
          if (key.endsWith("aws.txt")) {
            return {
              body: encoder.encode("ignored"),
              arrayBuffer: async () => encoder.encode(awsAccessKeyId).buffer,
            };
          }
          if (key.endsWith("key.txt")) {
            return { body: encoder.encode(privateKeyMarker).buffer };
          }
          if (key.endsWith("stream.txt")) {
            return { body: new Response("no warnings here").body };
          }
          return { body: new Uint8Array() };
        }),
      },
    });

    expect(warningInserts).toHaveLength(2);
    expect(auditInserts).toHaveLength(1);
    expect(JSON.parse(String(auditInserts[0]?.[7]))).toEqual(
      expect.objectContaining({
        warning_count: 2,
        added: 1,
        removed: 1,
        unchanged: 1,
      }),
    );
  });

  it("does not write audit events when replacement leaves warnings unchanged", async () => {
    const auditInserts: unknown[][] = [];
    const tx = {
      query: vi.fn(async (sql: string, params?: readonly unknown[]) => {
        if (sql.includes("insert into idempotency_records")) {
          return { rows: [{ workspace_id: workspaceId }] };
        }
        if (sql.includes("from safety_warnings")) {
          return {
            rows: [
              {
                code: "cloud_secret_identifier",
                severity: "warning",
                scope: "file",
                file_path: "aws.txt",
                message: "This revision appears to include a cloud credential identifier.",
              },
            ],
          };
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
          return { rows: [{ path: "aws.txt", r2_key: "objects/aws.txt", served_content_type: "text/plain" }] };
        }
        return { rows: [] };
      }),
      transaction: vi.fn(async (run) => run(tx)),
    };

    await handleSafetyScanBatch([{ body: safetyScanBody(), ack: vi.fn(), retry: vi.fn() }], {
      DB: db,
      ARTIFACTS: {
        list: vi.fn(),
        delete: vi.fn(),
        get: vi.fn(async () => ({ body: encoder.encode(awsAccessKeyId) })),
      },
    });

    expect(auditInserts).toHaveLength(0);
  });

  it("locks down ephemeral artifacts when URL Scanner reports malicious", async () => {
    const agentViewSigningSecret = "ephemeral-url-scan-secret";
    const denylistPut = vi.fn(async () => {});
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, result: { uuid: "scan-ephemeral" } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          result: { task: { status: "Finished" }, verdicts: { overall: { malicious: true } } },
        }),
      });
    vi.stubGlobal("fetch", fetchMock);
    const tx = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("insert into idempotency_records")) {
          return { rows: [{ workspace_id: workspaceId }] };
        }
        if (sql.includes("from platform_lockdowns")) {
          return { rows: [] };
        }
        if (sql.includes("insert into platform_lockdowns")) {
          return { rows: [{ id: "lkd_ephemeral" }] };
        }
        if (sql.includes("from safety_warnings")) {
          return { rows: [] };
        }
        if (sql.includes("insert into operation_events")) {
          return { rows: [] };
        }
        return { rows: [] };
      }),
      transaction: vi.fn(),
    };
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("from revisions r")) {
          return {
            rows: [{ status: "published", artifact_status: "active" }],
          };
        }
        if (sql.includes("select expires_at from artifacts")) {
          return { rows: [{ expires_at: "2030-01-01T00:00:00.000Z" }] };
        }
        if (sql.includes("from artifact_files")) {
          return {
            rows: [{ path: "index.html", r2_key: "objects/index.html", served_content_type: "text/html" }],
          };
        }
        return { rows: [] };
      }),
      transaction: vi.fn(async (run) => run(tx)),
    };

    await handleSafetyScanBatch(
      [
        {
          body: {
            ...safetyScanBody(),
            scanner_id: "ephemeral_tier",
            scanner_version: "1",
          },
          ack: vi.fn(),
          retry: vi.fn(),
        },
      ],
      {
        DB: db,
        API_BASE_URL: "https://api.test",
        AGENT_VIEW_SIGNING_SECRET: agentViewSigningSecret,
        CLOUDFLARE_ACCOUNT_ID: "acct",
        URL_SCANNER_API_TOKEN: "token",
        DENYLIST: { put: denylistPut },
        ARTIFACTS: {
          list: vi.fn(),
          delete: vi.fn(),
          get: async () => ({ body: encoder.encode("<html>hello</html>") }),
        },
        AI: { run: async () => ({ response: { safe: true } }) },
      },
    );

    expect(fetchMock).toHaveBeenCalled();
    const submitCall = fetchMock.mock.calls.find((call) => String(call[0]).includes("urlscanner/v2/scan"));
    expect(submitCall).toBeDefined();
    const submitBody = JSON.parse(String((submitCall?.[1] as { body?: string } | undefined)?.body ?? "{}")) as {
      url?: string;
    };
    const publishedUrl = submitBody.url ?? "";
    expect(publishedUrl).not.toContain(`${artifactId}.${revisionId}`);
    const scanToken = decodeURIComponent(publishedUrl.split("/v1/public/agent-view/")[1] ?? "");
    await expect(verifyAgentViewToken(scanToken, agentViewSigningSecret)).resolves.toMatchObject({
      artifact_id: artifactId,
      revision_id: revisionId,
    });
    expect(denylistPut).toHaveBeenCalledWith(
      `ad:${artifactId}`,
      expect.any(String),
      expect.objectContaining({ expirationTtl: expect.any(Number) }),
    );
    vi.unstubAllGlobals();
  });
});
