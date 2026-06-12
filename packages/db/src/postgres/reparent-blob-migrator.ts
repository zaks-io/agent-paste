import { artifactBytesEncryptionRingFromEnv } from "@agent-paste/rotation";
import { migrateWorkspaceBlobsForReparent } from "@agent-paste/storage";
import type { ReparentBlobMigrator } from "../types.js";

type R2Bucket = Parameters<typeof migrateWorkspaceBlobsForReparent>[0]["artifacts"];

export function reparentBlobMigratorFromEnv(env: {
  ARTIFACTS?: R2Bucket;
  ARTIFACT_BYTES_ENCRYPTION_KEY?: string;
  ARTIFACT_BYTES_ENCRYPTION_KEY_V2?: string;
  ARTIFACT_BYTES_ENCRYPTION_KID?: string;
}): ReparentBlobMigrator | undefined {
  const ring = artifactBytesEncryptionRingFromEnv(env);
  const artifacts = env.ARTIFACTS;
  if (!ring || !artifacts) {
    return undefined;
  }
  return {
    async migrate(input) {
      await migrateWorkspaceBlobsForReparent({
        artifacts,
        ring,
        fromWorkspaceId: input.fromWorkspaceId,
        toWorkspaceId: input.toWorkspaceId,
        blobs: input.blobs,
      });
    },
  };
}
