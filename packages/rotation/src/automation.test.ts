import { mintContentToken } from "@agent-paste/tokens/content";
import { mintUploadToken } from "@agent-paste/tokens/upload-url";
import { describe, expect, it } from "vitest";
import {
  applyKeyRingRotationStep,
  buildRotationPlan,
  collapseKeyRingAfterPromotion,
  finalizeKeyRingAfterDrop,
  inferSnapshotFromListedSecrets,
  keyRingFromProfileEnv,
  pepperRingFromProfileEnv,
  profileBindingsForTarget,
  VERSIONED_SECRET_PROFILES,
} from "./automation.js";
import { KeyRing } from "./key-ring.js";
import { PepperRing } from "./pepper-ring.js";
import { describeKeyRingState } from "./playbook.js";
import { verifyContentTokenWithKeyRing, verifyUploadTokenWithKeyRing } from "./signing.js";

describe("rotation automation plans", () => {
  it("plans stage/flip/drop wrangler actions for content signing", () => {
    const profile = VERSIONED_SECRET_PROFILES["content-signing"];
    const stagePlan = buildRotationPlan({
      profile,
      target: "preview",
      step: "stage",
      snapshot: { primaryBound: true, secondaryBound: false },
    });
    expect(stagePlan.actions).toHaveLength(4);
    expect(stagePlan.actions.every((action) => action.type === "put")).toBe(true);

    const flipPlan = buildRotationPlan({
      profile,
      target: "preview",
      step: "flip",
      snapshot: { primaryBound: true, secondaryBound: true, signingKidLabel: "v1" },
    });
    expect(flipPlan.actions).toEqual([
      expect.objectContaining({ type: "deploy-var", varName: "CONTENT_SIGNING_KID", varValue: "v2" }),
      expect.objectContaining({ type: "deploy-var", varName: "CONTENT_SIGNING_KID", varValue: "v2" }),
      expect.objectContaining({ type: "deploy-var", varName: "CONTENT_SIGNING_KID", varValue: "v2" }),
      expect.objectContaining({ type: "deploy-var", varName: "CONTENT_SIGNING_KID", varValue: "v2" }),
    ]);

    const dropPlan = buildRotationPlan({
      profile,
      target: "production",
      step: "drop",
      snapshot: { primaryBound: true, secondaryBound: true, signingKidLabel: "v2" },
    });
    expect(dropPlan.actions.filter((action) => action.type === "put")).toHaveLength(4);
    expect(dropPlan.actions.filter((action) => action.type === "delete")).toHaveLength(4);
    expect(dropPlan.notes.some((note) => note.includes("rotation-agent@platform"))).toBe(true);
  });

  it("plans kid-1 drop (not promote-to-v1) for api-key pepper and artifact-byte encryption", () => {
    for (const profileId of ["api-key-pepper", "artifact-bytes-encryption"] as const) {
      const profile = VERSIONED_SECRET_PROFILES[profileId];
      const dropPlan = buildRotationPlan({
        profile,
        target: "preview",
        step: "drop",
        snapshot: { primaryBound: true, secondaryBound: true, signingKidLabel: "v2" },
      });
      expect(dropPlan.actions.some((action) => action.type === "put")).toBe(false);
      expect(dropPlan.actions.filter((action) => action.type === "delete")).toHaveLength(profile.bindings.length);
      expect(dropPlan.actions.every((action) => action.type !== "deploy-var" || action.varValue === "v2")).toBe(true);
      expect(dropPlan.notes.join("\n")).toContain("Drop kid 1");
    }
  });

  it("plans emergency cutover actions", () => {
    const plan = buildRotationPlan({
      profile: VERSIONED_SECRET_PROFILES["upload-signing"],
      target: "preview",
      step: "emergency",
      snapshot: { primaryBound: true, secondaryBound: true },
    });
    expect(plan.actions.some((action) => action.type === "delete")).toBe(true);
    expect(plan.notes.join("\n")).toContain("Emergency cutover");
  });

  it("records drain guidance without mutating secrets", () => {
    const plan = buildRotationPlan({
      profile: VERSIONED_SECRET_PROFILES["api-key-pepper"],
      target: "preview",
      step: "drain",
      snapshot: { primaryBound: true, secondaryBound: true, signingKidLabel: "v2" },
      operatorIdentity: "human-operator@example.com",
    });
    expect(plan.actions).toHaveLength(0);
    expect(plan.notes.join("\n")).toContain("pepper_kid=1");
    expect(plan.operatorIdentity).toBe("human-operator@example.com");
  });

  it("infers snapshot from listed worker secrets", () => {
    const profile = VERSIONED_SECRET_PROFILES["artifact-bytes-encryption"];
    const listed = new Map([
      ["agent-paste-upload-preview", ["ARTIFACT_BYTES_ENCRYPTION_KEY"]],
      ["agent-paste-content-preview", ["ARTIFACT_BYTES_ENCRYPTION_KEY", "ARTIFACT_BYTES_ENCRYPTION_KEY_V2"]],
      ["agent-paste-jobs-preview", []],
    ]);
    const snapshot = inferSnapshotFromListedSecrets(profile, listed, "v1");
    expect(snapshot.primaryBound).toBe(true);
    expect(snapshot.secondaryBound).toBe(true);
    expect(profileBindingsForTarget(profile, "preview")).toHaveLength(3);
  });
});

describe("versioned secret rotation E2E (overlap → promotion)", () => {
  it("runs content signing overlap then promotion collapse", async () => {
    const profile = VERSIONED_SECRET_PROFILES["content-signing"];
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const payload = { artifact_id: "art_rot", revision_id: "rev_rot", exp };

    let ring = KeyRing.single("content-v1", 1);
    const legacyToken = await mintContentToken(payload, "content-v1");

    applyKeyRingRotationStep(ring, "stage", "content-v2");
    expect(describeKeyRingState(ring).stage).toBe("verify-old");

    applyKeyRingRotationStep(ring, "flip", "content-v2");
    const overlapEnv = {
      CONTENT_SIGNING_SECRET: "content-v1",
      CONTENT_SIGNING_SECRET_V2: "content-v2",
      CONTENT_SIGNING_KID: "v2",
    };
    const overlapRing = keyRingFromProfileEnv(profile, overlapEnv);
    expect(await verifyContentTokenWithKeyRing(legacyToken, overlapRing)).not.toBeNull();

    const newToken = await mintContentToken(payload, overlapRing.signingSecret());
    ring = collapseKeyRingAfterPromotion(overlapRing);
    expect(describeKeyRingState(ring).stage).toBe("drained");
    expect(await verifyContentTokenWithKeyRing(newToken, ring)).not.toBeNull();
    expect(await verifyContentTokenWithKeyRing(legacyToken, ring)).toBeNull();
  });

  it("runs upload signing overlap then promotion collapse", async () => {
    const profile = VERSIONED_SECRET_PROFILES["upload-signing"];
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const payload = {
      sid: "usess_rot",
      wid: "00000000-0000-4000-8000-000000000099",
      path: "rotate.txt",
      key: "k",
      size: 4,
      exp,
    };

    const legacyToken = await mintUploadToken(payload, "upload-v1");
    const overlapEnv = {
      UPLOAD_SIGNING_SECRET: "upload-v1",
      UPLOAD_SIGNING_SECRET_V2: "upload-v2",
      UPLOAD_SIGNING_KID: "v2",
    };
    const overlapRing = keyRingFromProfileEnv(profile, overlapEnv);
    expect(await verifyUploadTokenWithKeyRing(legacyToken, overlapRing)).not.toBeNull();

    const newToken = await mintUploadToken(payload, overlapRing.signingSecret());
    const collapsed = collapseKeyRingAfterPromotion(overlapRing);
    expect(await verifyUploadTokenWithKeyRing(newToken, collapsed)).not.toBeNull();
    expect(await verifyUploadTokenWithKeyRing(legacyToken, collapsed)).toBeNull();
  });

  it("applyKeyRingRotationStep emergency replaces the active signing secret", () => {
    const ring = KeyRing.single("upload-v1", 1);
    applyKeyRingRotationStep(ring, "emergency", "upload-emergency");
    expect(ring.signingKid).toBe(1);
    expect(ring.secretForKid(1)).toBe("upload-emergency");
  });

  it("rejects drop step on in-memory key ring", () => {
    const ring = KeyRing.single("only", 1);
    expect(() => applyKeyRingRotationStep(ring, "drop", "next")).toThrow(/finalizeKeyRingAfterDrop/);
  });

  it("runs api-key pepper overlap then drop kid 1 without invalidating kid-2 keys", () => {
    const profile = VERSIONED_SECRET_PROFILES["api-key-pepper"];
    const overlapRing = pepperRingFromProfileEnv(profile, {
      API_KEY_PEPPER_V1: "pepper-v1",
      API_KEY_PEPPER_V2: "pepper-v2",
      API_KEY_PEPPER_CURRENT_KID: "v2",
    });
    const droppedRing = PepperRing.fromKeyRing(finalizeKeyRingAfterDrop(overlapRing.asKeyRing(), profile.id));
    expect(droppedRing.verifyKids).toEqual([2]);
    expect(droppedRing.pepperForKid(2)).toBe("pepper-v2");

    const postDropEnvRing = PepperRing.fromEnv({
      API_KEY_PEPPER_V2: "pepper-v2",
      API_KEY_PEPPER_CURRENT_KID: "v2",
    });
    expect(postDropEnvRing.verifyKids).toEqual(droppedRing.verifyKids);
  });

  it("runs artifact-byte encryption overlap then drop kid 1 while kid 2 stays bound", () => {
    const profile = VERSIONED_SECRET_PROFILES["artifact-bytes-encryption"];
    const overlapRing = keyRingFromProfileEnv(profile, {
      ARTIFACT_BYTES_ENCRYPTION_KEY: "root-v1",
      ARTIFACT_BYTES_ENCRYPTION_KEY_V2: "root-v2",
      ARTIFACT_BYTES_ENCRYPTION_KID: "v2",
    });
    const droppedRing = finalizeKeyRingAfterDrop(overlapRing, profile.id);
    expect(droppedRing.verifyKids).toEqual([2]);
    expect(droppedRing.signingKid).toBe(2);
    expect(droppedRing.secretForKid(2)).toBe("root-v2");
    expect(droppedRing.secretForKid(1)).toBeUndefined();

    const postDropRing = keyRingFromProfileEnv(profile, {
      ARTIFACT_BYTES_ENCRYPTION_KEY_V2: "root-v2",
      ARTIFACT_BYTES_ENCRYPTION_KID: "v2",
    });
    expect(postDropRing.verifyKids).toEqual(droppedRing.verifyKids);
  });
});
