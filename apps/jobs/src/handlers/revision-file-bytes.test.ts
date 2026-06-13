import {
  seedEncryptedRevisionFile,
  seedEncryptedWorkspaceBlob,
  testArtifactBytesKeyRing,
} from "@agent-paste/storage/test-helpers/encrypted-artifact-fixture";
import { describe, expect, it } from "vitest";
import { readRevisionFileBytes } from "./revision-file-bytes.js";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const artifactId = "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
const revisionId = "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
const awsAccessKeyId = "AKIA" + "ABCDEFGHIJKLMNOP";

describe("readRevisionFileBytes", () => {
  describe("artifact bytes encrypt→store→read fidelity", () => {
    it("decrypts revision file ciphertext to the original plaintext", async () => {
      const fixture = await seedEncryptedRevisionFile({
        workspaceId,
        artifactId,
        revisionId,
        path: "secrets.txt",
        plaintext: awsAccessKeyId,
      });
      const ring = testArtifactBytesKeyRing();

      const plaintext = await readRevisionFileBytes({
        object: { body: fixture.body, customMetadata: fixture.customMetadata },
        objectKey: fixture.objectKey,
        workspaceId,
        encryptionRing: ring,
      });

      expect(new TextDecoder().decode(plaintext)).toBe(awsAccessKeyId);
      expect(plaintext).not.toEqual(fixture.body);
    });

    it("decrypts workspace blob ciphertext with v2 AAD", async () => {
      const sha256 = "a".repeat(64);
      const fixture = await seedEncryptedWorkspaceBlob({
        workspaceId,
        sha256,
        plaintext: "shared blob bytes",
      });
      const ring = testArtifactBytesKeyRing();

      const plaintext = await readRevisionFileBytes({
        object: { body: fixture.body, customMetadata: fixture.customMetadata },
        objectKey: fixture.objectKey,
        workspaceId,
        encryptionRing: ring,
      });

      expect(new TextDecoder().decode(plaintext)).toBe("shared blob bytes");
    });

    it.each([
      {
        name: "Uint8Array body",
        body: (fixture: Awaited<ReturnType<typeof seedEncryptedRevisionFile>>) => fixture.body,
      },
      {
        name: "ArrayBuffer body",
        body: (fixture: Awaited<ReturnType<typeof seedEncryptedRevisionFile>>) => fixture.body.buffer,
      },
      {
        name: "ReadableStream body",
        body: (fixture: Awaited<ReturnType<typeof seedEncryptedRevisionFile>>) => new Blob([fixture.body]).stream(),
      },
    ])("round-trips through $name shapes", async ({ body }) => {
      const fixture = await seedEncryptedRevisionFile({
        workspaceId,
        artifactId,
        revisionId,
        path: "index.html",
        plaintext: "<p>round-trip</p>",
      });
      const plaintext = await readRevisionFileBytes({
        object: { body: body(fixture), customMetadata: fixture.customMetadata },
        objectKey: fixture.objectKey,
        workspaceId,
        encryptionRing: testArtifactBytesKeyRing(),
      });
      expect(new TextDecoder().decode(plaintext)).toBe("<p>round-trip</p>");
    });
  });

  it("rejects objects without encryption metadata", async () => {
    const fixture = await seedEncryptedRevisionFile({
      workspaceId,
      artifactId,
      revisionId,
      path: "plain.txt",
      plaintext: "x",
    });
    await expect(
      readRevisionFileBytes({
        object: { body: fixture.body },
        objectKey: fixture.objectKey,
        workspaceId,
        encryptionRing: testArtifactBytesKeyRing(),
      }),
    ).rejects.toThrow(/metadata_missing/u);
  });

  it("rejects ciphertext that cannot be decrypted", async () => {
    const fixture = await seedEncryptedRevisionFile({
      workspaceId,
      artifactId,
      revisionId,
      path: "garbage.txt",
      plaintext: "x",
    });
    await expect(
      readRevisionFileBytes({
        object: {
          body: new Uint8Array(64).fill(9),
          customMetadata: fixture.customMetadata,
        },
        objectKey: fixture.objectKey,
        workspaceId,
        encryptionRing: testArtifactBytesKeyRing(),
      }),
    ).rejects.toThrow();
  });
});
