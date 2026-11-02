// Read and write workspace content-addressed blobs through the ADR 0063 encryption
// ring. ADR 0089 Stage 4 reconstruction (decrypt a base blob, apply a patch, store
// the result blob) and Bundle generation both perform exactly this encrypt-and-store
// / decrypt-by-sha dance; these helpers are the shared ends so neither re-derives the
// blob AAD context or the object key by hand.

import { LEGACY_SINGLE_PUT_MAX_BYTES } from "@agent-paste/config";
import {
  type ArtifactBytesKeyRing,
  bytesFromReadableBodyCapped,
  ciphertextByteLengthForPlaintext,
  decryptArtifactBytesWithKeyRing,
  encryptArtifactBytes,
  isArtifactBytesEncryptionMetadata,
  parseRevisionFileObjectKey,
  workspaceBlobObjectKeyFor,
} from "./artifact-bytes-encryption.js";

export type R2GetObjectBody = {
  body: ReadableStream | ArrayBuffer | Uint8Array | string | null | undefined;
  size?: number;
  customMetadata?: Record<string, string>;
};

export type WorkspaceBlobR2 = {
  get(key: string): Promise<R2GetObjectBody | null>;
  put(
    key: string,
    value: Uint8Array,
    options?: { httpMetadata?: Record<string, string>; customMetadata?: Record<string, string> },
  ): Promise<unknown>;
  head(key: string): Promise<unknown | null>;
};

// The encrypting side needs the active signing key (KeyRing); the decrypting side only
// needs kid lookup (ArtifactBytesKeyRing). KeyRing satisfies both.
export type ArtifactBytesSigningRing = ArtifactBytesKeyRing & {
  signingSecret(): string;
  signingKid: number;
};

export class WorkspaceBlobMissingError extends Error {
  constructor(readonly sha256: string) {
    super("workspace_blob_missing");
    this.name = "WorkspaceBlobMissingError";
  }
}

export class WorkspaceBlobMetadataError extends Error {
  constructor() {
    super("workspace_blob_metadata_missing");
    this.name = "WorkspaceBlobMetadataError";
  }
}

/**
 * Fetches and decrypts a workspace content-addressed blob by its sha256. The caller
 * supplies a validated (workspaceId, sha256) pair — never a raw object key — so the
 * read is constrained to a blob the caller has already proven it may access (the key
 * is derived here, not accepted from outside). Throws {@link WorkspaceBlobMissingError}
 * when the object is absent (an infra/consistency failure, mapped by the caller to a
 * retryable error, never a patch conflict).
 */
export async function readWorkspaceBlobBytes(input: {
  r2: Pick<WorkspaceBlobR2, "get">;
  workspaceId: string;
  sha256: string;
  ring: ArtifactBytesKeyRing;
  maxPlaintextBytes?: number;
  expectedPlaintextBytes?: number;
}): Promise<Uint8Array> {
  const key = workspaceBlobObjectKeyFor({ workspaceId: input.workspaceId, sha256: input.sha256 });
  const object = await input.r2.get(key);
  if (!object) {
    throw new WorkspaceBlobMissingError(input.sha256);
  }
  if (!isArtifactBytesEncryptionMetadata(object.customMetadata)) {
    throw new WorkspaceBlobMetadataError();
  }
  const ciphertext = await readCappedCiphertext(object, input);
  return decryptArtifactBytesWithKeyRing({
    ciphertext,
    ring: input.ring,
    metadata: object.customMetadata,
    context: { kind: "blob", workspaceId: input.workspaceId, sha256: input.sha256 },
  });
}

/**
 * Fetches and decrypts a revision-scoped file object (revision AAD v1) by its full key.
 * A patched file's uploaded diff bytes live under such a key (sha256 null, not content-
 * addressed), so reconstruction reads the diff this way. The key's artifact/revision/path
 * are bound into the AAD, so a substituted key fails decryption.
 */
export async function readRevisionFileObjectBytes(input: {
  r2: Pick<WorkspaceBlobR2, "get">;
  objectKey: string;
  workspaceId: string;
  ring: ArtifactBytesKeyRing;
  maxPlaintextBytes?: number;
  expectedPlaintextBytes?: number;
}): Promise<Uint8Array> {
  const parts = parseRevisionFileObjectKey(input.objectKey);
  if (!parts) {
    throw new WorkspaceBlobMetadataError();
  }
  const object = await input.r2.get(input.objectKey);
  if (!object) {
    throw new WorkspaceBlobMissingError(input.objectKey);
  }
  if (!isArtifactBytesEncryptionMetadata(object.customMetadata)) {
    throw new WorkspaceBlobMetadataError();
  }
  const ciphertext = await readCappedCiphertext(object, input);
  return decryptArtifactBytesWithKeyRing({
    ciphertext,
    ring: input.ring,
    metadata: object.customMetadata,
    context: {
      workspaceId: input.workspaceId,
      artifactId: parts.artifactId,
      revisionId: parts.revisionId,
      normalizedPath: parts.path,
    },
  });
}

/**
 * Encrypts plaintext under the workspace blob AAD (v2 = workspaceId + sha256) and PUTs
 * it at the content-addressed key. Idempotent: if the blob already exists it skips the
 * PUT (content-addressed, so any existing object is byte-identical), which makes a
 * finalize replay free and avoids rewriting an already-reconstructed result.
 */
export async function writeWorkspaceBlob(input: {
  r2: Pick<WorkspaceBlobR2, "put" | "head">;
  workspaceId: string;
  sha256: string;
  plaintext: Uint8Array;
  ring: ArtifactBytesSigningRing;
}): Promise<{ key: string; written: boolean }> {
  const key = workspaceBlobObjectKeyFor({ workspaceId: input.workspaceId, sha256: input.sha256 });
  if (await input.r2.head(key)) {
    return { key, written: false };
  }
  const encrypted = await encryptArtifactBytes({
    plaintext: input.plaintext,
    rootSecret: input.ring.signingSecret(),
    kid: input.ring.signingKid,
    context: { kind: "blob", workspaceId: input.workspaceId, sha256: input.sha256 },
  });
  await input.r2.put(key, encrypted.ciphertext, {
    httpMetadata: { contentType: "application/octet-stream" },
    customMetadata: encrypted.customMetadata,
  });
  return { key, written: true };
}

async function readCappedCiphertext(
  object: R2GetObjectBody,
  input: { maxPlaintextBytes?: number; expectedPlaintextBytes?: number },
): Promise<Uint8Array> {
  const cap = input.maxPlaintextBytes ?? LEGACY_SINGLE_PUT_MAX_BYTES;
  const expected = input.expectedPlaintextBytes;
  if (
    !Number.isSafeInteger(cap) ||
    cap < 0 ||
    (expected !== undefined && (!Number.isSafeInteger(expected) || expected < 0 || expected > cap))
  ) {
    throw new Error("invalid_workspace_blob_size");
  }
  const maxCiphertext = ciphertextByteLengthForPlaintext(cap);
  const expectedCiphertext = expected === undefined ? undefined : ciphertextByteLengthForPlaintext(expected);
  if (
    object.size !== undefined &&
    (!Number.isSafeInteger(object.size) ||
      object.size < ciphertextByteLengthForPlaintext(0) ||
      object.size > maxCiphertext ||
      (expectedCiphertext !== undefined && object.size !== expectedCiphertext))
  ) {
    if (object.body instanceof ReadableStream) await object.body.cancel().catch(() => undefined);
    throw new Error("workspace_blob_size_mismatch");
  }
  const body = object.body instanceof ReadableStream ? object.body : new Response(object.body as BodyInit | null).body;
  const ciphertext = await bytesFromReadableBodyCapped(body, expectedCiphertext ?? maxCiphertext);
  if (
    (expectedCiphertext !== undefined && ciphertext.byteLength !== expectedCiphertext) ||
    (object.size !== undefined && ciphertext.byteLength !== object.size)
  ) {
    throw new Error("workspace_blob_size_mismatch");
  }
  return ciphertext;
}
