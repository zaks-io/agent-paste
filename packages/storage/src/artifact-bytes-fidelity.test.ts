import { describe, expect, it } from "vitest";
import { ciphertextByteLengthForPlaintext, decryptArtifactBytesWithKeyRing } from "./artifact-bytes-encryption.js";
import { seedEncryptedRevisionFile, testArtifactBytesKeyRing } from "./test-helpers/encrypted-artifact-fixture.js";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const artifactId = "art_test";
const revisionId = "rev_test";

describe("artifact bytes encrypt→store→read fidelity", () => {
  it("storage decrypt helper returns plaintext produced by encryptArtifactBytes", async () => {
    const marker = "AKIA" + "ABCDEFGHIJKLMNOP";
    const fixture = await seedEncryptedRevisionFile({
      workspaceId,
      artifactId,
      revisionId,
      path: "scan-me.txt",
      plaintext: marker,
    });

    const plaintext = await decryptArtifactBytesWithKeyRing({
      ciphertext: fixture.body,
      ring: testArtifactBytesKeyRing(),
      metadata: fixture.customMetadata,
      context: {
        workspaceId,
        artifactId,
        revisionId,
        normalizedPath: "scan-me.txt",
      },
    });

    expect(new TextDecoder().decode(plaintext)).toBe(marker);
    expect(fixture.body.byteLength).toBe(ciphertextByteLengthForPlaintext(marker.length));
    expect(plaintext).not.toEqual(fixture.body);
  });
});
