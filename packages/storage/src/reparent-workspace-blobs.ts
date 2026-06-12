import {
  type ArtifactBytesKeyRing,
  bytesFromReadableBody,
  decryptArtifactBytesWithKeyRing,
  encryptArtifactBytes,
  isArtifactBytesEncryptionMetadata,
  workspaceBlobObjectKeyFor,
} from "./artifact-bytes-encryption.js";

export type WorkspaceBlobRef = {
  sha256: string;
  size_bytes: number;
  r2_key: string;
};

type R2ObjectBody = {
  body: ReadableStream | ArrayBuffer | Uint8Array | string | null;
  customMetadata?: Record<string, string>;
};

type R2Bucket = {
  head(key: string): Promise<{ customMetadata?: Record<string, string> } | null>;
  get(key: string): Promise<R2ObjectBody | null>;
  put(key: string, value: Uint8Array, options?: { customMetadata?: Record<string, string> }): Promise<unknown>;
};

export function destWorkspaceBlobKey(input: { workspaceId: string; sha256: string }): string {
  return workspaceBlobObjectKeyFor(input);
}

export async function migrateWorkspaceBlobForReparent(input: {
  artifacts: R2Bucket;
  ring: ArtifactBytesKeyRing;
  fromWorkspaceId: string;
  toWorkspaceId: string;
  blob: WorkspaceBlobRef;
}): Promise<void> {
  const destKey = destWorkspaceBlobKey({ workspaceId: input.toWorkspaceId, sha256: input.blob.sha256 });
  if (destKey === input.blob.r2_key) {
    return;
  }
  const existing = await input.artifacts.head(destKey);
  if (existing) {
    return;
  }
  const source = await input.artifacts.get(input.blob.r2_key);
  if (!source) {
    throw new Error("reparent_source_blob_missing");
  }
  if (!isArtifactBytesEncryptionMetadata(source.customMetadata)) {
    throw new Error("reparent_source_blob_not_encrypted");
  }
  const ciphertext = await bytesFromReadableBody(source.body);
  const kid = Number.parseInt(source.customMetadata.enc_kid, 10);
  const rootSecret = input.ring.secretForKid(kid);
  if (!rootSecret) {
    throw new Error("reparent_unknown_encryption_kid");
  }
  const plaintext = await decryptArtifactBytesWithKeyRing({
    ciphertext,
    ring: input.ring,
    metadata: source.customMetadata,
    context: { kind: "blob", workspaceId: input.fromWorkspaceId, sha256: input.blob.sha256 },
  });
  const encrypted = await encryptArtifactBytes({
    plaintext,
    rootSecret,
    kid,
    context: { kind: "blob", workspaceId: input.toWorkspaceId, sha256: input.blob.sha256 },
  });
  await input.artifacts.put(destKey, encrypted.ciphertext, { customMetadata: encrypted.customMetadata });
}

export async function migrateWorkspaceBlobsForReparent(input: {
  artifacts: R2Bucket;
  ring: ArtifactBytesKeyRing;
  fromWorkspaceId: string;
  toWorkspaceId: string;
  blobs: readonly WorkspaceBlobRef[];
}): Promise<void> {
  const seen = new Set<string>();
  for (const blob of input.blobs) {
    const dedupeKey = `${blob.sha256}:${blob.size_bytes}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    await migrateWorkspaceBlobForReparent({
      artifacts: input.artifacts,
      ring: input.ring,
      fromWorkspaceId: input.fromWorkspaceId,
      toWorkspaceId: input.toWorkspaceId,
      blob,
    });
  }
}
