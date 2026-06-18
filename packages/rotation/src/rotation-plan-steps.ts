import type {
  VersionedSecretBinding,
  VersionedSecretEnvSnapshot,
  VersionedSecretProfile,
  VersionedSecretProfileId,
  WranglerSecretAction,
} from "./versioned-secret.js";

function profilePersistsKidInRecords(profileId: VersionedSecretProfileId): boolean {
  return profileId === "api-key-pepper" || profileId === "artifact-bytes-encryption";
}

export type RotationPlanStepContext = {
  profile: VersionedSecretProfile;
  snapshot: VersionedSecretEnvSnapshot;
  bindings: VersionedSecretBinding[];
  valuePlaceholder: string;
};

export type RotationPlanStepPart = {
  actions: WranglerSecretAction[];
  notes: string[];
};

function deployVarActions(
  bindings: VersionedSecretBinding[],
  profile: VersionedSecretProfile,
  target: "preview" | "production",
  varValue: string,
): WranglerSecretAction[] {
  return bindings.map((binding) => ({
    type: "deploy-var" as const,
    worker: binding.worker,
    cwd: `apps/${binding.app}`,
    envName: target,
    varName: profile.kidVarName,
    varValue,
  }));
}

function putSecretActions(
  bindings: VersionedSecretBinding[],
  secretName: string,
  valuePlaceholder: string,
): WranglerSecretAction[] {
  return bindings.map((binding) => ({
    type: "put" as const,
    worker: binding.worker,
    name: secretName,
    valuePlaceholder,
  }));
}

function deleteSecretActions(bindings: VersionedSecretBinding[], secretName: string): WranglerSecretAction[] {
  return bindings.map((binding) => ({
    type: "delete" as const,
    worker: binding.worker,
    name: secretName,
  }));
}

export function buildStageRotationPlanPart(ctx: RotationPlanStepContext): RotationPlanStepPart {
  const notes: string[] = [];
  if (!ctx.snapshot.primaryBound) {
    notes.push("Primary secret is not bound; use bootstrap or first-deploy scripts instead of overlap rotation.");
  }
  if (ctx.snapshot.secondaryBound) {
    notes.push(`${ctx.profile.secondarySecretName} is already bound; skip stage unless recovering from a bad state.`);
  }
  notes.push(`Keep ${ctx.profile.kidVarName} at v1 on all Workers until stage completes.`);
  notes.push("After stage, run flip, then drain, then drop.");
  return {
    actions: putSecretActions(ctx.bindings, ctx.profile.secondarySecretName, ctx.valuePlaceholder),
    notes,
  };
}

export function buildFlipRotationPlanPart(
  ctx: RotationPlanStepContext,
  target: "preview" | "production",
): RotationPlanStepPart {
  const notes: string[] = [];
  if (!ctx.snapshot.secondaryBound) {
    notes.push(`Bind ${ctx.profile.secondarySecretName} on every Worker before flip.`);
  }
  notes.push("New mints use kid 2; verifiers still accept kid 1 during overlap.");
  notes.push(`Next: drain — ${ctx.profile.drainHint}`);
  return {
    actions: deployVarActions(ctx.bindings, ctx.profile, target, "v2"),
    notes,
  };
}

export function buildDrainRotationPlanPart(ctx: RotationPlanStepContext): RotationPlanStepPart {
  return {
    actions: [],
    notes: [
      ctx.profile.drainHint,
      "Hosted smoke (preview/production) should pass before drop when credentials are approved.",
      "Record completion in the ops log with operator, timestamp, and verification command.",
    ],
  };
}

function buildDropKidPersistingPlanPart(
  ctx: RotationPlanStepContext,
  target: "preview" | "production",
): RotationPlanStepPart {
  const notes: string[] = [];
  if (!ctx.snapshot.secondaryBound) {
    notes.push(`${ctx.profile.secondarySecretName} must stay bound until drop completes.`);
  }
  notes.push(
    "Drop kid 1 only: delete the primary (kid 1) secret, keep _V2 and active kid v2. Stored pepper_kid / enc_kid values are not relabeled.",
  );
  return {
    actions: [
      ...deleteSecretActions(ctx.bindings, ctx.profile.baseSecretName),
      ...deployVarActions(ctx.bindings, ctx.profile, target, "v2"),
    ],
    notes,
  };
}

function buildDropPromoteCollapsePlanPart(
  ctx: RotationPlanStepContext,
  target: "preview" | "production",
): RotationPlanStepPart {
  const notes: string[] = [];
  if (!ctx.snapshot.secondaryBound) {
    notes.push(`${ctx.profile.secondarySecretName} must stay bound until drop completes.`);
  }
  notes.push("Promote the v2 value into the primary secret, reset kid to v1, deploy, verify, then delete _V2.");
  const actions: WranglerSecretAction[] = [];
  for (const binding of ctx.bindings) {
    actions.push({
      type: "put",
      worker: binding.worker,
      name: ctx.profile.baseSecretName,
      valuePlaceholder: `<promoted-${ctx.profile.secondarySecretName}>`,
    });
    actions.push({
      type: "deploy-var",
      worker: binding.worker,
      cwd: `apps/${binding.app}`,
      envName: target,
      varName: ctx.profile.kidVarName,
      varValue: "v1",
    });
    actions.push({
      type: "delete",
      worker: binding.worker,
      name: ctx.profile.secondarySecretName,
    });
  }
  return { actions, notes };
}

export function buildDropRotationPlanPart(
  ctx: RotationPlanStepContext,
  target: "preview" | "production",
): RotationPlanStepPart {
  if (profilePersistsKidInRecords(ctx.profile.id)) {
    return buildDropKidPersistingPlanPart(ctx, target);
  }
  return buildDropPromoteCollapsePlanPart(ctx, target);
}

export function buildEmergencyRotationPlanPart(
  ctx: RotationPlanStepContext,
  target: "preview" | "production",
): RotationPlanStepPart {
  const actions: WranglerSecretAction[] = [];
  for (const binding of ctx.bindings) {
    actions.push({
      type: "put",
      worker: binding.worker,
      name: ctx.profile.baseSecretName,
      valuePlaceholder: ctx.valuePlaceholder,
    });
    actions.push({
      type: "deploy-var",
      worker: binding.worker,
      cwd: `apps/${binding.app}`,
      envName: target,
      varName: ctx.profile.kidVarName,
      varValue: "v1",
    });
    if (ctx.snapshot.secondaryBound) {
      actions.push({
        type: "delete",
        worker: binding.worker,
        name: ctx.profile.secondarySecretName,
      });
    }
  }
  return {
    actions,
    notes: ["Emergency cutover invalidates overlap; use only when staging is not possible."],
  };
}
