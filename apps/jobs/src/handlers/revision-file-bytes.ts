import {
  type ArtifactBytesKeyRing,
  bytesFromReadableBody,
  decryptArtifactBytesWithKeyRing,
  isArtifactBytesEncryptionMetadata,
  parseRevisionFileObjectKey,
} from "@agent-paste/storage";
import type { R2ObjectBody } from "../env.js";

export async function readRevisionFileBytes(input: {
  object: R2ObjectBody;
  objectKey: string;
  workspaceId: string;
  encryptionRing: ArtifactBytesKeyRing;
}): Promise<Uint8Array> {
  const ciphertext = await bytesFromReadableBody(input.object.body);
  if (!isArtifactBytesEncryptionMetadata(input.object.customMetadata)) {
    throw new Error("artifact_bytes_metadata_missing");
  }
  const keyParts = parseRevisionFileObjectKey(input.objectKey);
  if (!keyParts) {
    throw new Error("artifact_bytes_invalid_object_key");
  }
  return decryptArtifactBytesWithKeyRing({
    ciphertext,
    ring: input.encryptionRing,
    metadata: input.object.customMetadata,
    context: {
      workspaceId: input.workspaceId,
      artifactId: keyParts.artifactId,
      revisionId: keyParts.revisionId,
      normalizedPath: keyParts.path,
    },
  });
}
