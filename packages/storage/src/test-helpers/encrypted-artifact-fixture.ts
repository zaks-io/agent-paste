import { artifactBytesEncryptionRingFromEnv } from "@agent-paste/rotation";
import {
  type ArtifactBytesEncryptionMetadata,
  encryptArtifactBytes,
  workspaceBlobObjectKeyFor,
} from "../artifact-bytes-encryption.js";

/** Synthetic root secret for encrypted artifact-byte test fixtures only. */
export const TEST_ARTIFACT_BYTES_ROOT_SECRET = "test-artifact-bytes-encryption-key";

export const testArtifactBytesEncryptionEnv = {
  ARTIFACT_BYTES_ENCRYPTION_KEY: TEST_ARTIFACT_BYTES_ROOT_SECRET,
} as const;

export function testArtifactBytesKeyRing() {
  const ring = artifactBytesEncryptionRingFromEnv(testArtifactBytesEncryptionEnv);
  if (!ring) {
    throw new Error("test_artifact_bytes_key_ring_unavailable");
  }
  return ring;
}

export type StoredEncryptedObjectFixture = {
  body: Uint8Array;
  customMetadata: ArtifactBytesEncryptionMetadata;
  objectKey: string;
  plaintext: Uint8Array;
};

function plaintextBytes(plaintext: string | Uint8Array): Uint8Array {
  return typeof plaintext === "string" ? new TextEncoder().encode(plaintext) : plaintext;
}

/**
 * Seeds an R2-shaped revision file object through the real encryptArtifactBytes path.
 * Consumers should read `body` back through their production decrypt helper, not
 * by treating ciphertext as plaintext.
 */
export async function seedEncryptedRevisionFile(input: {
  workspaceId: string;
  artifactId: string;
  revisionId: string;
  path: string;
  plaintext: string | Uint8Array;
}): Promise<StoredEncryptedObjectFixture> {
  const bytes = plaintextBytes(input.plaintext);
  const encrypted = await encryptArtifactBytes({
    plaintext: bytes,
    rootSecret: TEST_ARTIFACT_BYTES_ROOT_SECRET,
    kid: 1,
    context: {
      workspaceId: input.workspaceId,
      artifactId: input.artifactId,
      revisionId: input.revisionId,
      normalizedPath: input.path,
    },
  });
  return {
    body: encrypted.ciphertext,
    customMetadata: encrypted.customMetadata,
    objectKey: `artifacts/${input.artifactId}/revisions/${input.revisionId}/files/${input.path}`,
    plaintext: bytes,
  };
}

/** Seeds a workspace blob object encrypted with v2 blob AAD. */
export async function seedEncryptedWorkspaceBlob(input: {
  workspaceId: string;
  sha256: string;
  plaintext: string | Uint8Array;
}): Promise<StoredEncryptedObjectFixture> {
  const bytes = plaintextBytes(input.plaintext);
  const encrypted = await encryptArtifactBytes({
    plaintext: bytes,
    rootSecret: TEST_ARTIFACT_BYTES_ROOT_SECRET,
    kid: 1,
    context: {
      kind: "blob",
      workspaceId: input.workspaceId,
      sha256: input.sha256,
    },
  });
  return {
    body: encrypted.ciphertext,
    customMetadata: encrypted.customMetadata,
    objectKey: workspaceBlobObjectKeyFor({ workspaceId: input.workspaceId, sha256: input.sha256 }),
    plaintext: bytes,
  };
}
