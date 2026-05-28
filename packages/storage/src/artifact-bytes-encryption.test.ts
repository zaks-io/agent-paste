import { describe, expect, it } from "vitest";
import {
  ARTIFACT_BYTES_ENCRYPTION_OVERHEAD_BYTES,
  bytesFromReadableBody,
  ciphertextByteLengthForPlaintext,
  composeArtifactBytesAad,
  decryptArtifactBytes,
  decryptArtifactBytesWithKeyRing,
  encryptArtifactBytes,
  encryptionMetadataForKid,
  isArtifactBytesEncryptionMetadata,
  parseRevisionFileObjectKey,
  plaintextByteLengthFromStoredObject,
} from "./artifact-bytes-encryption.js";

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
