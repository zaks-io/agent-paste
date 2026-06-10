import type { SqlExecutor } from "@agent-paste/db";
import type { ArtifactBytesKeyRing } from "@agent-paste/storage";
import type { Env } from "../env.js";
import { readRevisionFileBytes } from "./revision-file-bytes.js";

type R2GetObject = NonNullable<NonNullable<Env["ARTIFACTS"]>["get"]>;

type RevisionFileRow = {
  path: string;
  r2_key: string;
  served_content_type: string;
};

export async function loadScannerFiles(
  executor: SqlExecutor,
  input: {
    workspaceId: string;
    artifactId: string;
    revisionId: string;
    getObject: R2GetObject;
    encryptionRing: ArtifactBytesKeyRing;
  },
): Promise<Array<{ path: string; contentType: string; bytes: Uint8Array }>> {
  const files = await loadRevisionFiles(executor, input.artifactId, input.revisionId);
  const scannerFiles = [];
  for (const file of files) {
    const object = await input.getObject(file.r2_key);
    if (!object?.body) {
      throw new Error(`missing_r2_object:${file.path}`);
    }
    scannerFiles.push({
      path: file.path,
      contentType: file.served_content_type,
      bytes: await readRevisionFileBytes({
        object,
        objectKey: file.r2_key,
        workspaceId: input.workspaceId,
        encryptionRing: input.encryptionRing,
      }),
    });
  }
  return scannerFiles;
}

async function loadRevisionFiles(
  executor: SqlExecutor,
  artifactId: string,
  revisionId: string,
): Promise<RevisionFileRow[]> {
  const result = await executor.query<RevisionFileRow>(
    `select path, r2_key, served_content_type
     from artifact_files
     where artifact_id = $1 and revision_id = $2
     order by path asc`,
    [artifactId, revisionId],
  );
  return result.rows;
}
