import { encryptArtifactBytes } from "@agent-paste/storage";
import {
  seedEncryptedRevisionFile,
  testArtifactBytesEncryptionEnv,
} from "@agent-paste/storage/test-helpers/encrypted-artifact-fixture";
import { verifyAgentViewToken } from "@agent-paste/tokens/agent-view";
import { describe, expect, it, vi } from "vitest";
import type { Env } from "../env.js";
import { createMockSqlExecutor } from "../test-helpers/mock-sql-executor.js";
import { handleSafetyScanBatch } from "./safety-scan.js";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const artifactId = "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
const revisionId = "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
const encoder = new TextEncoder();
const awsAccessKeyId = "AKIA" + "ABCDEFGHIJKLMNOP";
const privateKeyMarker = "-----BEGIN " + "PRIVATE KEY-----";
const artifactBytesEncryptionEnv = {
  ARTIFACT_BYTES_ENCRYPTION_KEY: "test-artifact-bytes-encryption-key",
};

function r2KeyFor(path: string) {
  return `artifacts/${artifactId}/revisions/${revisionId}/files/${path}`;
}

async function encryptedRevisionFile(path: string, plaintext: string) {
  const encrypted = await encryptArtifactBytes({
    plaintext: encoder.encode(plaintext),
    rootSecret: artifactBytesEncryptionEnv.ARTIFACT_BYTES_ENCRYPTION_KEY,
    kid: 1,
    context: {
      workspaceId,
      artifactId,
      revisionId,
      normalizedPath: path,
    },
  });
  return { body: encrypted.ciphertext, customMetadata: encrypted.customMetadata };
}

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
      DB: createMockSqlExecutor(vi.fn(async () => ({ rows: [] }))),
    });

    expect(ack).toHaveBeenCalledOnce();
    expect(retry).not.toHaveBeenCalled();
  });

  it("retries active revisions when the artifact bucket binding is missing", async () => {
    const ack = vi.fn();
    const retry = vi.fn();

    await handleSafetyScanBatch([{ body: safetyScanBody(), ack, retry }], {
      ...artifactBytesEncryptionEnv,
      DB: createMockSqlExecutor(vi.fn(async () => ({ rows: [{ status: "published", artifact_status: "active" }] }))),
    });

    expect(ack).not.toHaveBeenCalled();
    expect(retry).toHaveBeenCalledOnce();
  });

  it("retries active revisions when the artifact bytes encryption ring is missing", async () => {
    const ack = vi.fn();
    const retry = vi.fn();
    const get = vi.fn();

    await handleSafetyScanBatch([{ body: safetyScanBody(), ack, retry }], {
      DB: createMockSqlExecutor(vi.fn(async () => ({ rows: [{ status: "published", artifact_status: "active" }] }))),
      ARTIFACTS: { list: vi.fn(), delete: vi.fn(), get },
    });

    expect(ack).not.toHaveBeenCalled();
    expect(retry).toHaveBeenCalledOnce();
    expect(get).not.toHaveBeenCalled();
  });

  it("acks retained or deleted revisions without scanning R2", async () => {
    const ack = vi.fn();
    const get = vi.fn();

    await handleSafetyScanBatch([{ body: safetyScanBody(), ack, retry: vi.fn() }], {
      DB: createMockSqlExecutor(vi.fn(async () => ({ rows: [{ status: "retained", artifact_status: "active" }] }))),
      ARTIFACTS: { list: vi.fn(), delete: vi.fn(), get },
    });

    expect(ack).toHaveBeenCalledOnce();
    expect(get).not.toHaveBeenCalled();
  });

  it("retries when a revision file is missing from R2", async () => {
    const retry = vi.fn();

    await handleSafetyScanBatch([{ body: safetyScanBody(), ack: vi.fn(), retry }], {
      ...artifactBytesEncryptionEnv,
      DB: createMockSqlExecutor(
        vi.fn(async (sql: string) => {
          if (sql.includes("from revisions r")) {
            return { rows: [{ status: "published", artifact_status: "active" }] };
          }
          if (sql.includes("from artifact_files")) {
            return {
              rows: [{ path: "missing.txt", r2_key: r2KeyFor("missing.txt"), served_content_type: "text/plain" }],
            };
          }
          return { rows: [] };
        }),
      ),
      ARTIFACTS: { list: vi.fn(), delete: vi.fn(), get: vi.fn(async () => null) },
    });

    expect(retry).toHaveBeenCalledOnce();
  });

  it("retries instead of scanning when a stored object lacks encryption metadata", async () => {
    const ack = vi.fn();
    const retry = vi.fn();

    await handleSafetyScanBatch([{ body: safetyScanBody(), ack, retry }], {
      ...artifactBytesEncryptionEnv,
      DB: createMockSqlExecutor(
        vi.fn(async (sql: string) => {
          if (sql.includes("from revisions r")) {
            return { rows: [{ status: "published", artifact_status: "active" }] };
          }
          if (sql.includes("from artifact_files")) {
            return {
              rows: [{ path: "plain.txt", r2_key: r2KeyFor("plain.txt"), served_content_type: "text/plain" }],
            };
          }
          return { rows: [] };
        }),
      ),
      ARTIFACTS: {
        list: vi.fn(),
        delete: vi.fn(),
        get: vi.fn(async () => ({ body: encoder.encode(awsAccessKeyId) })),
      },
    });

    expect(ack).not.toHaveBeenCalled();
    expect(retry).toHaveBeenCalledOnce();
  });

  it("retries instead of scanning when ciphertext cannot be decrypted", async () => {
    const ack = vi.fn();
    const retry = vi.fn();

    await handleSafetyScanBatch([{ body: safetyScanBody(), ack, retry }], {
      ...artifactBytesEncryptionEnv,
      DB: createMockSqlExecutor(
        vi.fn(async (sql: string) => {
          if (sql.includes("from revisions r")) {
            return { rows: [{ status: "published", artifact_status: "active" }] };
          }
          if (sql.includes("from artifact_files")) {
            return {
              rows: [{ path: "garbage.txt", r2_key: r2KeyFor("garbage.txt"), served_content_type: "text/plain" }],
            };
          }
          return { rows: [] };
        }),
      ),
      ARTIFACTS: {
        list: vi.fn(),
        delete: vi.fn(),
        get: vi.fn(async () => ({
          body: new Uint8Array(64).fill(7),
          customMetadata: { enc_kid: "1", enc_alg: "aes-256-gcm", enc_aad_v: "v1" },
        })),
      },
    });

    expect(ack).not.toHaveBeenCalled();
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
    const db = createMockSqlExecutor(
      vi.fn(async (sql: string) => {
        if (sql.includes("from revisions r")) {
          return { rows: [{ status: "published", artifact_status: "active" }] };
        }
        if (sql.includes("from artifact_files")) {
          return {
            rows: [
              {
                path: "index.html",
                r2_key: r2KeyFor("index.html"),
                served_content_type: "text/html; charset=utf-8",
              },
            ],
          };
        }
        return { rows: [] };
      }),
      tx.query,
    );
    const ack = vi.fn();
    const storedObject = await encryptedRevisionFile("index.html", `<form><input type="password"></form>`);
    let artifacts: NonNullable<Env["ARTIFACTS"]>;
    const get = vi.fn(async function (this: unknown) {
      expect(this).toBe(artifacts);
      return storedObject;
    });
    artifacts = {
      list: vi.fn(),
      delete: vi.fn(),
      get,
    };

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
        ...artifactBytesEncryptionEnv,
        DB: db,
        ARTIFACTS: artifacts,
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
    const db = createMockSqlExecutor(
      vi.fn(async (sql: string) => {
        if (sql.includes("from revisions r")) {
          return { rows: [{ status: "published", artifact_status: "active" }] };
        }
        if (sql.includes("from artifact_files")) {
          return {
            rows: [
              { path: "aws.txt", r2_key: r2KeyFor("aws.txt"), served_content_type: "text/plain" },
              { path: "key.txt", r2_key: r2KeyFor("key.txt"), served_content_type: "text/plain" },
              { path: "empty.txt", r2_key: r2KeyFor("empty.txt"), served_content_type: "text/plain" },
              { path: "stream.txt", r2_key: r2KeyFor("stream.txt"), served_content_type: "text/plain" },
            ],
          };
        }
        return { rows: [] };
      }),
      tx.query,
    );
    const awsObject = await encryptedRevisionFile("aws.txt", awsAccessKeyId);
    const keyObject = await encryptedRevisionFile("key.txt", privateKeyMarker);
    const emptyObject = await encryptedRevisionFile("empty.txt", "");
    const streamObject = await encryptedRevisionFile("stream.txt", "no warnings here");

    await handleSafetyScanBatch([{ body: safetyScanBody(), ack: vi.fn(), retry: vi.fn() }], {
      ...artifactBytesEncryptionEnv,
      DB: db,
      ARTIFACTS: {
        list: vi.fn(),
        delete: vi.fn(),
        get: vi.fn(async (key: string) => {
          if (key.endsWith("aws.txt")) {
            return awsObject;
          }
          if (key.endsWith("key.txt")) {
            return { body: keyObject.body.buffer, customMetadata: keyObject.customMetadata };
          }
          if (key.endsWith("stream.txt")) {
            return {
              body: new Response(Uint8Array.from(streamObject.body)).body,
              customMetadata: streamObject.customMetadata,
            };
          }
          return emptyObject;
        }),
      },
    });

    expect(warningInserts).toHaveLength(2);
    const insertedCodes = warningInserts.map((params) => params[6]);
    expect(insertedCodes).toEqual(expect.arrayContaining(["cloud_secret_identifier", "private_key_material"]));
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
    const db = createMockSqlExecutor(
      vi.fn(async (sql: string) => {
        if (sql.includes("from revisions r")) {
          return { rows: [{ status: "published", artifact_status: "active" }] };
        }
        if (sql.includes("from artifact_files")) {
          return { rows: [{ path: "aws.txt", r2_key: r2KeyFor("aws.txt"), served_content_type: "text/plain" }] };
        }
        return { rows: [] };
      }),
      tx.query,
    );
    const storedObject = await encryptedRevisionFile("aws.txt", awsAccessKeyId);

    await handleSafetyScanBatch([{ body: safetyScanBody(), ack: vi.fn(), retry: vi.fn() }], {
      ...artifactBytesEncryptionEnv,
      DB: db,
      ARTIFACTS: {
        list: vi.fn(),
        delete: vi.fn(),
        get: vi.fn(async () => storedObject),
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
    const db = createMockSqlExecutor(
      vi.fn(async (sql: string) => {
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
            rows: [{ path: "index.html", r2_key: r2KeyFor("index.html"), served_content_type: "text/html" }],
          };
        }
        return { rows: [] };
      }),
      tx.query,
    );
    const storedObject = await encryptedRevisionFile("index.html", "<html>hello</html>");

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
        ...artifactBytesEncryptionEnv,
        DB: db,
        API_BASE_URL: "https://api.test",
        AGENT_VIEW_SIGNING_SECRET: agentViewSigningSecret,
        CLOUDFLARE_ACCOUNT_ID: "acct",
        URL_SCANNER_API_TOKEN: "token",
        DENYLIST: { put: denylistPut },
        ARTIFACTS: {
          list: vi.fn(),
          delete: vi.fn(),
          get: async () => storedObject,
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

describe("artifact bytes encrypt→store→read fidelity", () => {
  it("detects built-in scanner warnings only after decrypting encrypted fixtures", async () => {
    const warningInserts: unknown[][] = [];
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
        return { rows: [] };
      }),
      transaction: vi.fn(),
    };
    const db = createMockSqlExecutor(
      vi.fn(async (sql: string) => {
        if (sql.includes("from revisions r")) {
          return { rows: [{ status: "published", artifact_status: "active" }] };
        }
        if (sql.includes("from artifact_files")) {
          return {
            rows: [{ path: "aws.txt", r2_key: r2KeyFor("aws.txt"), served_content_type: "text/plain" }],
          };
        }
        return { rows: [] };
      }),
      tx.query,
    );
    const fixture = await seedEncryptedRevisionFile({
      workspaceId,
      artifactId,
      revisionId,
      path: "aws.txt",
      plaintext: awsAccessKeyId,
    });

    await handleSafetyScanBatch([{ body: safetyScanBody(), ack: vi.fn(), retry: vi.fn() }], {
      ...testArtifactBytesEncryptionEnv,
      DB: db,
      ARTIFACTS: {
        list: vi.fn(),
        delete: vi.fn(),
        get: async () => ({ body: fixture.body, customMetadata: fixture.customMetadata }),
      },
    });

    expect(warningInserts).toHaveLength(1);
    expect(warningInserts[0]?.[6]).toBe("cloud_secret_identifier");
    expect(fixture.body).not.toEqual(encoder.encode(awsAccessKeyId));
  });
});
