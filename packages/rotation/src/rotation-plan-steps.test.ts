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
    expect(part.actions).toHaveLength(bindings.length);
    expect(part.actions.every((action) => action.type === "put")).toBe(true);
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
    expect(part.actions).toEqual([expect.objectContaining({ type: "deploy-var", varValue: "v2" })]);
    expect(part.notes.join("\n")).toContain(profile.drainHint);
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
    expect(part.actions.some((action) => action.type === "put")).toBe(false);
    expect(part.actions.filter((action) => action.type === "delete")).toHaveLength(bindings.length);
    expect(part.notes.join("\n")).toContain("Drop kid 1");
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
    expect(part.actions.some((action) => action.type === "delete")).toBe(true);
    expect(part.notes.join("\n")).toContain("Emergency cutover");
  });
});
