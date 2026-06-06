import { describe, expect, it } from "vitest";
import { artifactBytesEncryptionRingFromEnv, contentSigningRingFromEnv, uploadSigningRingFromEnv } from "./workers.js";

function expectRedactedWorkerError(
  action: () => unknown,
  expectedMessage: string,
  secretValues: readonly string[],
): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toBe(expectedMessage);
    for (const secretValue of secretValues) {
      expect(message).not.toContain(secretValue);
    }
    return;
  }
  throw new Error("expected worker key ring resolution to fail");
}

describe("worker signing rings from env", () => {
  it("builds artifact bytes encryption ring from versioned env vars", () => {
    const ring = artifactBytesEncryptionRingFromEnv({
      ARTIFACT_BYTES_ENCRYPTION_KEY: "root-v1",
      ARTIFACT_BYTES_ENCRYPTION_KEY_V2: "root-v2",
      ARTIFACT_BYTES_ENCRYPTION_KID: "v2",
    });
    expect(ring?.signingKid).toBe(2);
    expect(ring?.secretForKid(1)).toBe("root-v1");
    expect(ring?.secretForKid(2)).toBe("root-v2");
  });

  it("returns undefined when artifact bytes encryption key is missing", () => {
    expect(artifactBytesEncryptionRingFromEnv({})).toBeUndefined();
  });

  it("still builds upload signing ring independently", () => {
    expect(uploadSigningRingFromEnv({ UPLOAD_SIGNING_SECRET: "upload" })?.signingKid).toBe(1);
  });

  it("fails loudly when content signing is flipped to an unbound V2 kid", () => {
    expectRedactedWorkerError(
      () =>
        contentSigningRingFromEnv({
          CONTENT_SIGNING_SECRET: "content-v1",
          CONTENT_SIGNING_KID: "v2",
        }),
      "key_ring_inconsistent_signing_kid:2",
      ["content-v1"],
    );
  });

  it("fails loudly when upload signing is flipped to an unbound V2 kid", () => {
    expectRedactedWorkerError(
      () =>
        uploadSigningRingFromEnv({
          UPLOAD_SIGNING_SECRET: "upload-v1",
          UPLOAD_SIGNING_KID: "v2",
        }),
      "key_ring_inconsistent_signing_kid:2",
      ["upload-v1"],
    );
  });
});
