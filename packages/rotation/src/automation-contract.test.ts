import { describe, expect, it } from "vitest";
import {
  applyKeyRingRotationStep,
  applyPepperRotationStep,
  buildRotationPlan,
  inferSnapshotFromListedSecrets,
  pepperRingFromProfileEnv,
  profilePersistsKidInRecords,
  VERSIONED_SECRET_PROFILES,
} from "./automation.js";
import { KeyRing } from "./key-ring.js";
import { PepperRing } from "./pepper-ring.js";

describe("rotation automation contract", () => {
  it("defines operational metadata for every versioned secret profile", () => {
    expect(VERSIONED_SECRET_PROFILES).toMatchObject({
      "content-signing": {
        id: "content-signing",
        baseSecretName: "CONTENT_SIGNING_SECRET",
        secondarySecretName: "CONTENT_SIGNING_SECRET_V2",
        kidVarName: "CONTENT_SIGNING_KID",
        bindings: [
          { app: "api", worker: "agent-paste-api" },
          { app: "upload", worker: "agent-paste-upload" },
          { app: "content", worker: "agent-paste-content" },
          { app: "jobs", worker: "agent-paste-jobs" },
        ],
      },
      "upload-signing": {
        id: "upload-signing",
        baseSecretName: "UPLOAD_SIGNING_SECRET",
        secondarySecretName: "UPLOAD_SIGNING_SECRET_V2",
        kidVarName: "UPLOAD_SIGNING_KID",
        bindings: [{ app: "upload", worker: "agent-paste-upload" }],
      },
      "api-key-pepper": {
        id: "api-key-pepper",
        baseSecretName: "API_KEY_PEPPER_V1",
        secondarySecretName: "API_KEY_PEPPER_V2",
        kidVarName: "API_KEY_PEPPER_CURRENT_KID",
        bindings: [
          { app: "api", worker: "agent-paste-api" },
          { app: "upload", worker: "agent-paste-upload" },
        ],
      },
      "artifact-bytes-encryption": {
        id: "artifact-bytes-encryption",
        baseSecretName: "ARTIFACT_BYTES_ENCRYPTION_KEY",
        secondarySecretName: "ARTIFACT_BYTES_ENCRYPTION_KEY_V2",
        kidVarName: "ARTIFACT_BYTES_ENCRYPTION_KID",
        bindings: [
          { app: "api", worker: "agent-paste-api" },
          { app: "upload", worker: "agent-paste-upload" },
          { app: "content", worker: "agent-paste-content" },
          { app: "jobs", worker: "agent-paste-jobs" },
        ],
      },
    });
  });

  it("only treats stored-kid profiles as kid-persisting", () => {
    expect(profilePersistsKidInRecords("content-signing")).toBe(false);
    expect(profilePersistsKidInRecords("upload-signing")).toBe(false);
    expect(profilePersistsKidInRecords("api-key-pepper")).toBe(true);
    expect(profilePersistsKidInRecords("artifact-bytes-encryption")).toBe(true);
  });

  it("preserves an explicit signing kid label when inferring listed-secret state", () => {
    const profile = VERSIONED_SECRET_PROFILES["upload-signing"];
    const snapshot = inferSnapshotFromListedSecrets(
      profile,
      new Map([["agent-paste-upload-preview", ["UPLOAD_SIGNING_SECRET", "UPLOAD_SIGNING_SECRET_V2"]]]),
      "v2",
    );
    expect(snapshot).toEqual({ primaryBound: true, secondaryBound: true, signingKidLabel: "v2" });
  });

  it("rejects pepper ring construction for non-pepper profiles", () => {
    expect(() =>
      pepperRingFromProfileEnv(VERSIONED_SECRET_PROFILES["content-signing"], {
        CONTENT_SIGNING_SECRET: "content-v1",
      }),
    ).toThrow("pepper_ring_profile_mismatch:content-signing");
  });

  it("applies direct key-ring flip and drain transitions", () => {
    const ring = KeyRing.fromEntries(1, [
      { kid: 1, secret: "content-v1" },
      { kid: 2, secret: "content-v2" },
    ]);
    applyKeyRingRotationStep(ring, "flip", "unused");
    expect(ring.signingKid).toBe(2);
    expect(ring.signingSecret()).toBe("content-v2");

    applyKeyRingRotationStep(ring, "drain", "unused");
    expect(ring.signingKid).toBe(2);
    expect(ring.verifyKids).toEqual([1, 2]);
  });

  it("applies pepper stage through the generic rotation step helper", () => {
    const ring = PepperRing.single("pepper-v1");
    applyPepperRotationStep(ring, "stage", "pepper-v2");
    expect(ring.verifyKids).toEqual([1, 2]);
    expect(ring.pepperForKid(2)).toBe("pepper-v2");
  });

  it("simulates a v2 signing ring when the snapshot kid is v2", () => {
    const plan = buildRotationPlan({
      profile: VERSIONED_SECRET_PROFILES["content-signing"],
      target: "preview",
      step: "drain",
      snapshot: { primaryBound: true, secondaryBound: false, signingKidLabel: "v2" },
    });
    expect(plan.stage).toBe("sign-new");
  });
});
