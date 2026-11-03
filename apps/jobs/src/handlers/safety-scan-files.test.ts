import {
  seedEncryptedWorkspaceBlob,
  testArtifactBytesKeyRing,
} from "@agent-paste/storage/test-helpers/encrypted-artifact-fixture";
import { PGlite } from "@electric-sql/pglite";
import { expect, it, vi } from "vitest";
import {
  applyMigrations,
  executorForPglite,
  seedPublishedRevision,
  workspaceExecutor,
} from "../test-helpers/pglite.js";
import { loadScannerFiles } from "./safety-scan-files.js";

it("scans ordinary encrypted files while skipping chunked files without fetching their virtual keys", async () => {
  const client = new PGlite();
  try {
    await applyMigrations(client);
    const executor = executorForPglite(client);
    const workspaceId = "00000000-0000-4000-8000-000000000077";
    const artifactId = "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z7";
    const revisionId = "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z7";
    const apiKeyId = "key_01HZY7Q8X9Y2S3T4V5W6X7Y8Z7";
    const encrypted = await seedEncryptedWorkspaceBlob({
      workspaceId,
      sha256: "a".repeat(64),
      plaintext: "<p>scan</p>",
    });
    await seedPublishedRevision(executor, {
      workspaceId,
      artifactId,
      revisionId,
      apiKeyId,
      r2Key: encrypted.objectKey,
    });
    const tenant = workspaceExecutor(executor, workspaceId);
    await tenant.query(
      `insert into artifact_files (workspace_id,artifact_id,revision_id,path,size_bytes,served_content_type,r2_key,content_format,uploaded_at) values ($1,$2,$3,'video.bin',11534336,'application/octet-stream','virtual-key','chunked-v1',now())`,
      [workspaceId, artifactId, revisionId],
    );
    const getObject = vi.fn(async () => ({ body: encrypted.body, customMetadata: encrypted.customMetadata }));
    const files = await loadScannerFiles(tenant, {
      workspaceId,
      artifactId,
      revisionId,
      getObject,
      encryptionRing: testArtifactBytesKeyRing(),
    });
    expect(files).toHaveLength(1);
    expect(new TextDecoder().decode(files[0]?.bytes)).toBe("<p>scan</p>");
    expect(getObject).toHaveBeenCalledExactlyOnceWith(encrypted.objectKey);
  } finally {
    await client.close();
  }
}, 30_000);
