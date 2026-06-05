import { dropRetiredKidAfterPromotion, keyRingFromProfileEnv, VERSIONED_SECRET_PROFILES } from "@agent-paste/rotation";
import { describe, expect, it } from "vitest";
import {
  ARTIFACT_BYTES_ENCRYPTION_OVERHEAD_BYTES,
  bytesFromReadableBody,
  bytesFromReadableBodyCapped,
  ciphertextByteLengthForPlaintext,
  composeArtifactBytesAad,
  decryptArtifactBytes,
  decryptArtifactBytesWithKeyRing,
  encryptArtifactBytes,
  encryptionMetadataForKid,
  isArtifactBytesEncryptionMetadata,
  parseRevisionFileObjectKey,
  plaintextByteLengthFromStoredObject,
  ReadableBodyTooLargeError,
} from "./artifact-bytes-encryption.js";

function chunkedStream(chunks: Uint8Array[]): { stream: ReadableStream<Uint8Array>; cancelled: () => boolean } {
  let cancelled = false;
  let index = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) {
        const chunk = chunks[index];
        if (chunk) {
          controller.enqueue(chunk);
        }
        index += 1;
        return;
      }
      controller.close();
    },
    cancel() {
      cancelled = true;
    },
  });
  return { stream, cancelled: () => cancelled };
}

const context = {
  workspaceId: "00000000-0000-4000-8000-000000000001",
  artifactId: "art_test",
  revisionId: "rev_test",
  normalizedPath: "index.html",
};

describe("artifact-bytes encryption", () => {
  it("round-trips plaintext with metadata and AAD binding", async () => {
    const plaintext = new TextEncoder().encode("hello artifact bytes");
    const encrypted = await encryptArtifactBytes({
      plaintext,
      rootSecret: "root-secret-v1",
      kid: 1,
      context,
    });

    expect(encrypted.ciphertext.byteLength).toBe(ciphertextByteLengthForPlaintext(plaintext.byteLength));
    expect(isArtifactBytesEncryptionMetadata(encrypted.customMetadata)).toBe(true);
    expect(encrypted.customMetadata).toEqual(encryptionMetadataForKid(1));

    const decrypted = await decryptArtifactBytes({
      ciphertext: encrypted.ciphertext,
      rootSecret: "root-secret-v1",
      metadata: encrypted.customMetadata,
      context,
    });
    expect(new TextDecoder().decode(decrypted)).toBe("hello artifact bytes");
  });

  it("fails decrypt when AAD context does not match", async () => {
    const encrypted = await encryptArtifactBytes({
      plaintext: new TextEncoder().encode("secret"),
      rootSecret: "root-secret-v1",
      kid: 1,
      context,
    });

    await expect(
      decryptArtifactBytes({
        ciphertext: encrypted.ciphertext,
        rootSecret: "root-secret-v1",
        metadata: encrypted.customMetadata,
        context: { ...context, normalizedPath: "other.html" },
      }),
    ).rejects.toThrow();
  });

  it("decrypts overlap-era enc_kid=2 ciphertext after drop retires kid 1", async () => {
    const profile = VERSIONED_SECRET_PROFILES["artifact-bytes-encryption"];
    const overlapRing = keyRingFromProfileEnv(profile, {
      ARTIFACT_BYTES_ENCRYPTION_KEY: "root-secret-v1",
      ARTIFACT_BYTES_ENCRYPTION_KEY_V2: "root-secret-v2",
      ARTIFACT_BYTES_ENCRYPTION_KID: "v2",
    });
    const encrypted = await encryptArtifactBytes({
      plaintext: new TextEncoder().encode("overlap ciphertext"),
      rootSecret: "root-secret-v2",
      kid: 2,
      context,
    });
    const droppedRing = dropRetiredKidAfterPromotion(overlapRing);
    const decrypted = await decryptArtifactBytesWithKeyRing({
      ciphertext: encrypted.ciphertext,
      ring: droppedRing,
      metadata: encrypted.customMetadata,
      context,
    });
    expect(new TextDecoder().decode(decrypted)).toBe("overlap ciphertext");
  });

  it("decrypts with the matching kid from a key ring", async () => {
    const secrets = new Map<number, string>([
      [1, "root-secret-v1"],
      [2, "root-secret-v2"],
    ]);
    const ring = { secretForKid: (kid: number) => secrets.get(kid) };
    const encrypted = await encryptArtifactBytes({
      plaintext: new TextEncoder().encode("rotated"),
      rootSecret: "root-secret-v2",
      kid: 2,
      context,
    });

    const decrypted = await decryptArtifactBytesWithKeyRing({
      ciphertext: encrypted.ciphertext,
      ring,
      metadata: encrypted.customMetadata,
      context,
    });
    expect(new TextDecoder().decode(decrypted)).toBe("rotated");
  });

  it("rejects unknown encryption kids", async () => {
    const ring = { secretForKid: (kid: number) => (kid === 1 ? "root-secret-v1" : undefined) };
    const encrypted = await encryptArtifactBytes({
      plaintext: new TextEncoder().encode("x"),
      rootSecret: "root-secret-v1",
      kid: 1,
      context,
    });

    await expect(
      decryptArtifactBytesWithKeyRing({
        ciphertext: encrypted.ciphertext,
        ring,
        metadata: { ...encrypted.customMetadata, enc_kid: "9" },
        context,
      }),
    ).rejects.toThrow(/unknown_kid/u);
  });

  it("rejects invalid encryption metadata", () => {
    expect(isArtifactBytesEncryptionMetadata(undefined)).toBe(false);
    expect(
      isArtifactBytesEncryptionMetadata({
        enc_kid: "1",
        enc_alg: "aes-256-gcm",
      }),
    ).toBe(false);
    expect(
      isArtifactBytesEncryptionMetadata({
        enc_kid: "1",
        enc_alg: "chacha20",
        enc_aad_v: "v1",
      }),
    ).toBe(false);
    expect(
      isArtifactBytesEncryptionMetadata({
        enc_kid: "",
        enc_alg: "aes-256-gcm",
        enc_aad_v: "v1",
      }),
    ).toBe(false);
  });

  it("rejects decrypt when ciphertext is too short or kid is invalid", async () => {
    const encrypted = await encryptArtifactBytes({
      plaintext: new TextEncoder().encode("x"),
      rootSecret: "root-secret-v1",
      kid: 1,
      context,
    });

    await expect(
      decryptArtifactBytes({
        ciphertext: new Uint8Array(4),
        rootSecret: "root-secret-v1",
        metadata: encrypted.customMetadata,
        context,
      }),
    ).rejects.toThrow(/too_short/u);

    for (const encKid of ["not-a-number", "1abc", "1.5"]) {
      await expect(
        decryptArtifactBytes({
          ciphertext: encrypted.ciphertext,
          rootSecret: "root-secret-v1",
          metadata: { ...encrypted.customMetadata, enc_kid: encKid },
          context,
        }),
      ).rejects.toThrow(/invalid_kid/u);

      await expect(
        decryptArtifactBytesWithKeyRing({
          ciphertext: encrypted.ciphertext,
          ring: { secretForKid: () => "root-secret-v1" },
          metadata: { ...encrypted.customMetadata, enc_kid: encKid },
          context,
        }),
      ).rejects.toThrow(/invalid_kid/u);
    }
  });

  it("reads upload bodies from common ReadableStream shapes", async () => {
    expect(await bytesFromReadableBody(null)).toEqual(new Uint8Array());
    expect(await bytesFromReadableBody(undefined)).toEqual(new Uint8Array());
    expect(await bytesFromReadableBody("plain-text")).toEqual(new TextEncoder().encode("plain-text"));

    const arrayBuffer = new TextEncoder().encode("from-buffer").buffer;
    expect(await bytesFromReadableBody(arrayBuffer)).toEqual(new Uint8Array(arrayBuffer));

    const uint8 = new TextEncoder().encode("from-uint8");
    expect(await bytesFromReadableBody(uint8)).toBe(uint8);

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("from-stream"));
        controller.close();
      },
    });
    expect(await bytesFromReadableBody(stream)).toEqual(new TextEncoder().encode("from-stream"));
  });

  it("reads capped bodies that fit within the limit", async () => {
    expect(await bytesFromReadableBodyCapped(null, 10)).toEqual(new Uint8Array());
    const { stream } = chunkedStream([new Uint8Array([1, 2]), new Uint8Array([3, 4, 5])]);
    expect(await bytesFromReadableBodyCapped(stream, 5)).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
  });

  it("throws and cancels the stream once the cap is exceeded mid-stream", async () => {
    const { stream, cancelled } = chunkedStream([
      new Uint8Array([1, 2, 3]),
      new Uint8Array([4, 5, 6, 7]),
      new Uint8Array([8, 9]),
    ]);
    await expect(bytesFromReadableBodyCapped(stream, 5)).rejects.toBeInstanceOf(ReadableBodyTooLargeError);
    expect(cancelled()).toBe(true);
  });

  it("parses revision file object keys and stored plaintext sizes", () => {
    expect(parseRevisionFileObjectKey("artifacts/art_a/revisions/rev_b/files/dir/file.txt")).toEqual({
      artifactId: "art_a",
      revisionId: "rev_b",
      path: "dir/file.txt",
    });
    expect(parseRevisionFileObjectKey("env/dev/workspaces/ws/artifacts/art/revisions/rev/bundle.zip")).toBeNull();
    expect(plaintextByteLengthFromStoredObject(ARTIFACT_BYTES_ENCRYPTION_OVERHEAD_BYTES + 4)).toBe(4);
    expect(() => plaintextByteLengthFromStoredObject(4)).toThrow(/too_short/u);
    expect(composeArtifactBytesAad(context)).toEqual(
      new TextEncoder().encode("v1|00000000-0000-4000-8000-000000000001|art_test|rev_test|index.html"),
    );
  });
});
