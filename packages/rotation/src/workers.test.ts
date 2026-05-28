import { describe, expect, it } from "vitest";
import { artifactBytesEncryptionRingFromEnv, uploadSigningRingFromEnv } from "./workers.js";

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
});
