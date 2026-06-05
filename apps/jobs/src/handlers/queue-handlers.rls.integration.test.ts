import { encryptArtifactBytes } from "@agent-paste/storage";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { applyMaliciousUrlLockdown } from "../safety/platform-lockdown.js";
import {
  applyMigrations,
  executorForPglite,
  platformExecutor,
  seedPublishedRevision,
  workspaceExecutor,
} from "../test-helpers/pglite.js";
import { handleBundleGenerateBatch } from "./bundle-generate.js";
import { handleSafetyScanBatch } from "./safety-scan.js";

const workspaceId = "00000000-0000-4000-8000-000000000055";
const artifactId = "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z0";
const revisionId = "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z0";
const apiKeyId = "key_01HZY7Q8X9Y2S3T4V5W6X7Y8Z0";
const lockdownArtifactId = "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z1";
const r2Key = `artifacts/${artifactId}/revisions/${revisionId}/files/index.html`;
const artifactBytesEncryptionEnv = {
  ARTIFACT_BYTES_ENCRYPTION_KEY: "test-artifact-bytes-encryption-key",
};

describe("queue handlers under FORCE RLS (app_role)", () => {
  let executor: ReturnType<typeof executorForPglite>;

  beforeAll(async () => {
    const client = new PGlite();
    await applyMigrations(client);
    executor = executorForPglite(client);
    await seedPublishedRevision(executor, {
      workspaceId,
      artifactId,
      revisionId,
      apiKeyId,
      bundleStatus: "pending",
      r2Key,
    });
  }, 90_000);

  it("returns zero revision rows when the executor is unscoped (fail-closed)", async () => {
    const revision = await executor.query<{ status: string; artifact_status: string }>(
      `select r.status, a.status as artifact_status
       from revisions r
       inner join artifacts a on a.id = r.artifact_id
       where r.workspace_id = $1 and r.id = $2`,
      [workspaceId, revisionId],
    );
    expect(revision.rows).toEqual([]);

    const files = await executor.query<{ path: string }>(
      `select path
       from artifact_files
       where artifact_id = $1 and revision_id = $2`,
      [artifactId, revisionId],
    );
    expect(files.rows).toEqual([]);

    const lockdowns = await executor.query<{ id: string }>(
      `select id from platform_lockdowns where scope = 'artifact' and target_id = $1`,
      [artifactId],
    );
    expect(lockdowns.rows).toEqual([]);
  });

  it("loads the revision under workspace scope and retries when artifact storage is unavailable", async () => {
    const ack = vi.fn();
    const retry = vi.fn();
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
          retry,
        },
      ],
      { DB: executor },
    );

    expect(retry).toHaveBeenCalledOnce();
    expect(ack).not.toHaveBeenCalled();
  });

  it("keeps existing safety warnings when the scoped handler sees an unchanged scan", async () => {
    const tenant = workspaceExecutor(executor, workspaceId);
    await tenant.query(
      `insert into safety_warnings
         (id, workspace_id, artifact_id, revision_id, scanner_id, scanner_version, code, severity, scope, file_path, message, created_at)
       values ('warn_rls_unchanged', $1, $2, $3, 'builtin_content', '1', 'credential_collection_form', 'warning', 'file', 'index.html', $4, now())`,
      [workspaceId, artifactId, revisionId, "This revision contains an HTML password form."],
    );
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
        DB: executor,
        ARTIFACTS: {
          list: vi.fn(),
          delete: vi.fn(),
          get: async () => ({
            body: new TextEncoder().encode(`<form><input type="password"></form>`),
          }),
        },
      },
    );

    expect(ack).toHaveBeenCalledOnce();
    const warnings = await tenant.query<{ code: string }>(
      `select code from safety_warnings where revision_id = $1 and scanner_id = 'builtin_content'`,
      [revisionId],
    );
    expect(warnings.rows).toEqual([{ code: "credential_collection_form" }]);
  });

  it("marks bundle ready when the bundle-generate handler runs with workspace scope", async () => {
    const encrypted = await encryptArtifactBytes({
      plaintext: new TextEncoder().encode("<html></html>"),
      rootSecret: artifactBytesEncryptionEnv.ARTIFACT_BYTES_ENCRYPTION_KEY,
      kid: 1,
      context: {
        workspaceId,
        artifactId,
        revisionId,
        normalizedPath: "index.html",
      },
    });
    const ack = vi.fn();
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
        DB: executor,
        ARTIFACTS: {
          list: vi.fn(),
          delete: vi.fn(),
          get: async () => ({ body: encrypted.ciphertext, customMetadata: encrypted.customMetadata }),
          put: vi.fn(async () => {}),
        },
      },
    );

    expect(ack).toHaveBeenCalledOnce();
    const revision = await workspaceExecutor(executor, workspaceId).query<{
      bundle_status: string;
      bundle_size_bytes: number | null;
    }>(`select bundle_status, bundle_size_bytes from revisions where id = $1`, [revisionId]);
    expect(revision.rows[0]).toMatchObject({ bundle_status: "ready", bundle_size_bytes: expect.any(Number) });
  });

  it("creates platform lockdown rows when applyMaliciousUrlLockdown uses platform scope", async () => {
    await applyMaliciousUrlLockdown(
      executor,
      { DENYLIST: { put: vi.fn(async () => {}) } },
      {
        workspaceId,
        artifactId: lockdownArtifactId,
        revisionId,
        now: "2026-05-20T00:00:00.000Z",
      },
    );

    const lockdowns = await platformExecutor(executor).query<{ target_id: string }>(
      `select target_id from platform_lockdowns where scope = 'artifact' and target_id = $1 and lifted_at is null`,
      [lockdownArtifactId],
    );
    expect(lockdowns.rows).toEqual([{ target_id: lockdownArtifactId }]);
  });
});
