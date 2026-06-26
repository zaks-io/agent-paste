import { describe, expect, it } from "vitest";
import { profileBindingsForTarget, VERSIONED_SECRET_PROFILES } from "./automation.js";
import {
  buildDrainRotationPlanPart,
  buildDropRotationPlanPart,
  buildEmergencyRotationPlanPart,
  buildFlipRotationPlanPart,
  buildStageRotationPlanPart,
} from "./rotation-plan-steps.js";

describe("rotation plan step builders", () => {
  it("builds stage actions for every worker binding", () => {
    const profile = VERSIONED_SECRET_PROFILES["content-signing"];
    const bindings = profileBindingsForTarget(profile, "preview");
    const part = buildStageRotationPlanPart({
      profile,
      snapshot: { primaryBound: true, secondaryBound: false },
      bindings,
      valuePlaceholder: "<generated-secret>",
    });
    expect(part.actions).toEqual(
      bindings.map((binding) => ({
        type: "put",
        worker: binding.worker,
        name: "CONTENT_SIGNING_SECRET_V2",
        valuePlaceholder: "<generated-secret>",
      })),
    );
    expect(part.notes.join("\n")).toContain("After stage, run flip");
  });

  it("builds flip deploy-var actions for every binding", () => {
    const profile = VERSIONED_SECRET_PROFILES["upload-signing"];
    const bindings = profileBindingsForTarget(profile, "production");
    const part = buildFlipRotationPlanPart(
      {
        profile,
        snapshot: { primaryBound: true, secondaryBound: true },
        bindings,
        valuePlaceholder: "<generated-secret>",
      },
      "production",
    );
    expect(part.actions).toEqual([
      {
        type: "deploy-var",
        worker: "agent-paste-upload-production",
        cwd: "apps/upload",
        envName: "production",
        varName: "UPLOAD_SIGNING_KID",
        varValue: "v2",
      },
    ]);
    expect(part.notes.join("\n")).toContain(profile.drainHint);
  });

  it("records bad-state guidance without changing stage action shape", () => {
    const profile = VERSIONED_SECRET_PROFILES["api-key-pepper"];
    const bindings = profileBindingsForTarget(profile, "preview");
    const part = buildStageRotationPlanPart({
      profile,
      snapshot: { primaryBound: false, secondaryBound: true },
      bindings,
      valuePlaceholder: "<pepper-v2>",
    });
    expect(part.actions).toEqual([
      {
        type: "put",
        worker: "agent-paste-api-preview",
        name: "API_KEY_PEPPER_V2",
        valuePlaceholder: "<pepper-v2>",
      },
      {
        type: "put",
        worker: "agent-paste-upload-preview",
        name: "API_KEY_PEPPER_V2",
        valuePlaceholder: "<pepper-v2>",
      },
    ]);
    expect(part.notes.length).toBeGreaterThan(2);
  });

  it("emits stage guidance for each unsafe stage precondition", () => {
    const profile = VERSIONED_SECRET_PROFILES["upload-signing"];
    const bindings = profileBindingsForTarget(profile, "preview");
    const build = (snapshot: { primaryBound: boolean; secondaryBound: boolean }) =>
      buildStageRotationPlanPart({
        profile,
        snapshot,
        bindings,
        valuePlaceholder: "<upload-v2>",
      }).notes;

    expect(build({ primaryBound: true, secondaryBound: false })).toHaveLength(2);
    expect(build({ primaryBound: false, secondaryBound: false })).toHaveLength(3);
    expect(build({ primaryBound: true, secondaryBound: true })).toHaveLength(3);
    expect(build({ primaryBound: false, secondaryBound: true })).toHaveLength(4);
  });

  it("builds drain guidance without wrangler actions", () => {
    const profile = VERSIONED_SECRET_PROFILES["api-key-pepper"];
    const part = buildDrainRotationPlanPart({
      profile,
      snapshot: { primaryBound: true, secondaryBound: true },
      bindings: profileBindingsForTarget(profile, "preview"),
      valuePlaceholder: "<generated-secret>",
    });
    expect(part.actions).toHaveLength(0);
    expect(part.notes.join("\n")).toContain("pepper_kid=1");
  });

  it("emits flip guidance when the secondary secret is not staged", () => {
    const profile = VERSIONED_SECRET_PROFILES["content-signing"];
    const bindings = profileBindingsForTarget(profile, "production");
    const build = (secondaryBound: boolean) =>
      buildFlipRotationPlanPart(
        {
          profile,
          snapshot: { primaryBound: true, secondaryBound },
          bindings,
          valuePlaceholder: "<content-v2>",
        },
        "production",
      ).notes;

    expect(build(true)).toHaveLength(2);
    expect(build(false)).toHaveLength(3);
  });

  it("builds kid-1 drop actions for pepper profiles", () => {
    const profile = VERSIONED_SECRET_PROFILES["api-key-pepper"];
    const bindings = profileBindingsForTarget(profile, "preview");
    const part = buildDropRotationPlanPart(
      {
        profile,
        snapshot: { primaryBound: true, secondaryBound: true },
        bindings,
        valuePlaceholder: "<generated-secret>",
      },
      "preview",
    );
    expect(part.actions).toEqual([
      {
        type: "delete",
        worker: "agent-paste-api-preview",
        name: "API_KEY_PEPPER_V1",
      },
      {
        type: "delete",
        worker: "agent-paste-upload-preview",
        name: "API_KEY_PEPPER_V1",
      },
      {
        type: "deploy-var",
        worker: "agent-paste-api-preview",
        cwd: "apps/api",
        envName: "preview",
        varName: "API_KEY_PEPPER_CURRENT_KID",
        varValue: "v2",
      },
      {
        type: "deploy-var",
        worker: "agent-paste-upload-preview",
        cwd: "apps/upload",
        envName: "preview",
        varName: "API_KEY_PEPPER_CURRENT_KID",
        varValue: "v2",
      },
    ]);
    expect(part.notes.join("\n")).toContain("Drop kid 1");
  });

  it("emits drop guidance when stored-kid profiles are missing the secondary secret", () => {
    const profile = VERSIONED_SECRET_PROFILES["artifact-bytes-encryption"];
    const bindings = profileBindingsForTarget(profile, "preview");
    const build = (secondaryBound: boolean) =>
      buildDropRotationPlanPart(
        {
          profile,
          snapshot: { primaryBound: true, secondaryBound, signingKidLabel: "v2" },
          bindings,
          valuePlaceholder: "<root-v2>",
        },
        "preview",
      ).notes;

    expect(build(true)).toHaveLength(1);
    expect(build(false)).toHaveLength(2);
  });

  it("builds promote-collapse drop actions for TTL-bound signing profiles", () => {
    const profile = VERSIONED_SECRET_PROFILES["upload-signing"];
    const part = buildDropRotationPlanPart(
      {
        profile,
        snapshot: { primaryBound: true, secondaryBound: true },
        bindings: profileBindingsForTarget(profile, "production"),
        valuePlaceholder: "<generated-secret>",
      },
      "production",
    );
    expect(part.actions).toEqual([
      {
        type: "put",
        worker: "agent-paste-upload-production",
        name: "UPLOAD_SIGNING_SECRET",
        valuePlaceholder: "<promoted-UPLOAD_SIGNING_SECRET_V2>",
      },
      {
        type: "deploy-var",
        worker: "agent-paste-upload-production",
        cwd: "apps/upload",
        envName: "production",
        varName: "UPLOAD_SIGNING_KID",
        varValue: "v1",
      },
      {
        type: "delete",
        worker: "agent-paste-upload-production",
        name: "UPLOAD_SIGNING_SECRET_V2",
      },
    ]);
  });

  it("emits promote-collapse guidance when TTL-bound profiles are missing the secondary secret", () => {
    const profile = VERSIONED_SECRET_PROFILES["content-signing"];
    const bindings = profileBindingsForTarget(profile, "production");
    const build = (secondaryBound: boolean) =>
      buildDropRotationPlanPart(
        {
          profile,
          snapshot: { primaryBound: true, secondaryBound, signingKidLabel: "v2" },
          bindings,
          valuePlaceholder: "<content-v2>",
        },
        "production",
      ).notes;

    expect(build(true)).toHaveLength(1);
    expect(build(false)).toHaveLength(2);
  });

  it("builds emergency cutover actions including secondary delete when bound", () => {
    const profile = VERSIONED_SECRET_PROFILES["upload-signing"];
    const bindings = profileBindingsForTarget(profile, "preview");
    const part = buildEmergencyRotationPlanPart(
      {
        profile,
        snapshot: { primaryBound: true, secondaryBound: true },
        bindings,
        valuePlaceholder: "<generated-secret>",
      },
      "preview",
    );
    expect(part.actions).toEqual([
      {
        type: "put",
        worker: "agent-paste-upload-preview",
        name: "UPLOAD_SIGNING_SECRET",
        valuePlaceholder: "<generated-secret>",
      },
      {
        type: "deploy-var",
        worker: "agent-paste-upload-preview",
        cwd: "apps/upload",
        envName: "preview",
        varName: "UPLOAD_SIGNING_KID",
        varValue: "v1",
      },
      {
        type: "delete",
        worker: "agent-paste-upload-preview",
        name: "UPLOAD_SIGNING_SECRET_V2",
      },
    ]);
    expect(part.notes.join("\n")).toContain("Emergency cutover");
  });

  it("does not delete a missing secondary during emergency cutover", () => {
    const profile = VERSIONED_SECRET_PROFILES["upload-signing"];
    const part = buildEmergencyRotationPlanPart(
      {
        profile,
        snapshot: { primaryBound: true, secondaryBound: false },
        bindings: profileBindingsForTarget(profile, "preview"),
        valuePlaceholder: "<generated-secret>",
      },
      "preview",
    );
    expect(part.actions).toEqual([
      expect.objectContaining({ type: "put", name: "UPLOAD_SIGNING_SECRET" }),
      expect.objectContaining({ type: "deploy-var", varValue: "v1" }),
    ]);
  });
});
