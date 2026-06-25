import { describe, expect, it } from "vitest";
import {
  ARTIFACT_BYTES_AAD_VERSION,
  ARTIFACT_BYTES_BLOB_AAD_VERSION,
  ARTIFACT_BYTES_DERIVATION_INFO,
  ARTIFACT_BYTES_ENCRYPTION_ALG,
  ARTIFACT_BYTES_ENCRYPTION_OVERHEAD_BYTES,
  bytesFromReadableBodyCapped,
  decryptArtifactBytes,
  encryptArtifactBytes,
  encryptionMetadataForKid,
  isArtifactBytesEncryptionMetadata,
  parseRevisionFileObjectKey,
  parseWorkspaceBlobObjectKey,
  plaintextByteLengthFromStoredObject,
  ReadableBodyTooLargeError,
  workspaceBlobObjectKeyFor,
} from "./artifact-bytes-encryption.js";

const SHA256 = "a".repeat(64);
const revisionContext = {
  workspaceId: "ws_edge",
  artifactId: "art_edge",
  revisionId: "rev_edge",
  normalizedPath: "index.html",
};

function streamFrom(chunks: Array<Uint8Array | undefined>): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk as Uint8Array);
      }
      controller.close();
    },
  });
}

describe("artifact-bytes encryption edge contracts", () => {
  it("keeps public crypto metadata constants stable", () => {
    expect(ARTIFACT_BYTES_DERIVATION_INFO).toBe("agent-paste/artifact-bytes/v1");
    expect(ARTIFACT_BYTES_ENCRYPTION_ALG).toBe("aes-256-gcm");
    expect(isArtifactBytesEncryptionMetadata(encryptionMetadataForKid(1, ARTIFACT_BYTES_AAD_VERSION))).toBe(true);
  });

  it("rejects object keys that only contain a valid key substring", () => {
    const revisionKey = "artifacts/art_edge/revisions/rev_edge/files/index.html";
    expect(parseRevisionFileObjectKey(`prefix/${revisionKey}`)).toBeNull();
    expect(parseRevisionFileObjectKey(`${revisionKey}\nignored`)).toBeNull();

    const blobKey = workspaceBlobObjectKeyFor({ workspaceId: "ws_edge", sha256: SHA256 });
    expect(parseWorkspaceBlobObjectKey(`prefix/${blobKey}`)).toBeNull();
    expect(parseWorkspaceBlobObjectKey(`${blobKey}/tail`)).toBeNull();
  });

  it("rejects sha256 values that only contain a valid digest substring", () => {
    expect(() => workspaceBlobObjectKeyFor({ workspaceId: "ws_edge", sha256: `x${SHA256}` })).toThrow(
      /invalid_sha256/u,
    );
    expect(() => workspaceBlobObjectKeyFor({ workspaceId: "ws_edge", sha256: `${SHA256}x` })).toThrow(
      /invalid_sha256/u,
    );
  });

  it("accepts exact encryption overhead as zero-byte plaintext length", () => {
    expect(plaintextByteLengthFromStoredObject(ARTIFACT_BYTES_ENCRYPTION_OVERHEAD_BYTES)).toBe(0);
  });

  it("rejects unsafe integer encryption kids before decrypting", async () => {
    await expect(
      decryptArtifactBytes({
        ciphertext: new Uint8Array(ARTIFACT_BYTES_ENCRYPTION_OVERHEAD_BYTES),
        rootSecret: "root-secret-v1",
        metadata: { ...encryptionMetadataForKid(1), enc_kid: "9007199254740992" },
        context: revisionContext,
      }),
    ).rejects.toThrow(/invalid_kid/u);
  });

  it("does not classify exact-overhead ciphertext as too short", async () => {
    await expect(
      decryptArtifactBytes({
        ciphertext: new Uint8Array(ARTIFACT_BYTES_ENCRYPTION_OVERHEAD_BYTES),
        rootSecret: "root-secret-v1",
        metadata: encryptionMetadataForKid(1, ARTIFACT_BYTES_BLOB_AAD_VERSION),
        context: revisionContext,
      }),
    ).rejects.toThrow(/aad_version_mismatch/u);
  });

  it("encrypts ArrayBuffer views that are not backed by ArrayBuffer", async () => {
    const plaintext = new Uint8Array(new SharedArrayBuffer(3));
    plaintext.set([1, 2, 3]);

    const encrypted = await encryptArtifactBytes({
      plaintext,
      rootSecret: "root-secret-v1",
      kid: 1,
      context: revisionContext,
    });
    const decrypted = await decryptArtifactBytes({
      ciphertext: encrypted.ciphertext,
      rootSecret: "root-secret-v1",
      metadata: encrypted.customMetadata,
      context: revisionContext,
    });

    expect(decrypted).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("keeps capped stream error details stable", () => {
    const error = new ReadableBodyTooLargeError();
    expect(error.message).toBe("readable_body_exceeds_limit");
    expect(error.name).toBe("ReadableBodyTooLargeError");
  });

  it("skips empty stream reads and releases the reader lock", async () => {
    const stream = streamFrom([undefined, new Uint8Array([7])]);

    expect(await bytesFromReadableBodyCapped(stream, 1)).toEqual(new Uint8Array([7]));
    const reader = stream.getReader();
    reader.releaseLock();
  });

  it("releases the reader lock after rejecting an oversized stream", async () => {
    const stream = streamFrom([new Uint8Array([1, 2]), new Uint8Array([3])]);

    await expect(bytesFromReadableBodyCapped(stream, 2)).rejects.toBeInstanceOf(ReadableBodyTooLargeError);
    const reader = stream.getReader();
    reader.releaseLock();
  });
});
