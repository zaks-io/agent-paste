import type { KeyRing } from "./key-ring.js";
import { createKeyRingFromVersionedEnv, KeyRing as KeyRingClass } from "./key-ring.js";
import { PepperRing } from "./pepper-ring.js";
import { describeKeyRingState, type RotationStage } from "./playbook.js";

/** Operator-facing rotation profile for ADR 0045 versioned Worker secrets. */
export type VersionedSecretProfileId =
  | "content-signing"
  | "upload-signing"
  | "api-key-pepper"
  | "artifact-bytes-encryption";

export type VersionedSecretBinding = {
  app: string;
  worker: string;
};

export type VersionedSecretProfile = {
  id: VersionedSecretProfileId;
  baseSecretName: string;
  secondarySecretName: string;
  kidVarName: string;
  bindings: VersionedSecretBinding[];
  /** Human-readable drain guidance (TTL or operational notes). */
  drainHint: string;
};

export type VersionedSecretRotationStep = "stage" | "flip" | "drain" | "drop" | "emergency";

export type VersionedSecretEnvSnapshot = {
  primaryBound: boolean;
  secondaryBound: boolean;
  signingKidLabel?: string;
};

export type WranglerSecretAction =
  | { type: "put"; worker: string; name: string; valuePlaceholder: string }
  | { type: "delete"; worker: string; name: string }
  | { type: "deploy-var"; worker: string; cwd: string; envName: string; varName: string; varValue: string };

export type RotationPlan = {
  profileId: VersionedSecretProfileId;
  step: VersionedSecretRotationStep;
  stage: RotationStage;
  operatorIdentity: string;
  actions: WranglerSecretAction[];
  notes: string[];
};

export const ROTATION_AGENT_OPERATOR_ID = "rotation-agent@platform";

/** Profiles that persist kid into stored records (DB rows, R2 metadata). */
export function profilePersistsKidInRecords(profileId: VersionedSecretProfileId): boolean {
  return profileId === "api-key-pepper" || profileId === "artifact-bytes-encryption";
}

export const VERSIONED_SECRET_PROFILES: Record<VersionedSecretProfileId, VersionedSecretProfile> = {
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
    drainHint: "Wait at least the longest content-token TTL (default 15 minutes) before drop so kid 1 tokens expire.",
  },
  "upload-signing": {
    id: "upload-signing",
    baseSecretName: "UPLOAD_SIGNING_SECRET",
    secondarySecretName: "UPLOAD_SIGNING_SECRET_V2",
    kidVarName: "UPLOAD_SIGNING_KID",
    bindings: [{ app: "upload", worker: "agent-paste-upload" }],
    drainHint: "Wait for in-flight signed upload URLs to expire (default UPLOAD_URL_TTL_SECONDS is 900) before drop.",
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
    drainHint: "Wait until no API Keys with pepper_kid=1 are required, or reissue long-lived keys, before drop.",
  },
  "artifact-bytes-encryption": {
    id: "artifact-bytes-encryption",
    baseSecretName: "ARTIFACT_BYTES_ENCRYPTION_KEY",
    secondarySecretName: "ARTIFACT_BYTES_ENCRYPTION_KEY_V2",
    kidVarName: "ARTIFACT_BYTES_ENCRYPTION_KID",
    bindings: [
      { app: "upload", worker: "agent-paste-upload" },
      { app: "content", worker: "agent-paste-content" },
      { app: "jobs", worker: "agent-paste-jobs" },
    ],
    drainHint:
      "Existing R2 ciphertext keeps its original enc_kid; only drop after no reads/writes still need the retired kid.",
  },
};

export function workerNameForTarget(workerPrefix: string, target: "preview" | "production"): string {
  return `${workerPrefix}-${target}`;
}

export function profileBindingsForTarget(
  profile: VersionedSecretProfile,
  target: "preview" | "production",
): VersionedSecretBinding[] {
  return profile.bindings.map((binding) => ({
    app: binding.app,
    worker: workerNameForTarget(binding.worker, target),
  }));
}

export function inferSnapshotFromListedSecrets(
  profile: VersionedSecretProfile,
  listedByWorker: ReadonlyMap<string, readonly string[]>,
  signingKidLabel?: string,
): VersionedSecretEnvSnapshot {
  const names = new Set<string>();
  for (const listed of listedByWorker.values()) {
    for (const name of listed) {
      names.add(name);
    }
  }
  return {
    primaryBound: names.has(profile.baseSecretName),
    secondaryBound: names.has(profile.secondarySecretName),
    ...(signingKidLabel ? { signingKidLabel } : {}),
  };
}

export function keyRingFromProfileEnv(
  profile: VersionedSecretProfile,
  env: Record<string, string | undefined>,
): KeyRing {
  return createKeyRingFromVersionedEnv({
    baseName: profile.baseSecretName,
    kidVarName: profile.kidVarName,
    env,
  });
}

export function pepperRingFromProfileEnv(
  profile: VersionedSecretProfile,
  env: Record<string, string | undefined>,
): PepperRing {
  if (profile.id !== "api-key-pepper") {
    throw new Error(`pepper_ring_profile_mismatch:${profile.id}`);
  }
  const pepperEnv: {
    API_KEY_PEPPER_V1?: string;
    API_KEY_PEPPER_V2?: string;
    API_KEY_PEPPER_CURRENT_KID?: string;
  } = {};
  const primary = env[profile.baseSecretName];
  if (primary) {
    pepperEnv.API_KEY_PEPPER_V1 = primary;
  }
  const secondary = env[profile.secondarySecretName];
  if (secondary) {
    pepperEnv.API_KEY_PEPPER_V2 = secondary;
  }
  const kid = env[profile.kidVarName];
  if (kid) {
    pepperEnv.API_KEY_PEPPER_CURRENT_KID = kid;
  }
  return PepperRing.fromEnv(pepperEnv);
}

/** Applies an in-memory ADR 0045 step to a key ring (used by overlap E2E tests). */
export function applyKeyRingRotationStep(ring: KeyRing, step: VersionedSecretRotationStep, nextSecret: string): void {
  switch (step) {
    case "stage":
      ring.stageVerifyKey(2, nextSecret);
      return;
    case "flip":
      ring.promoteSigningKid(2);
      return;
    case "drain":
      return;
    case "drop":
      throw new Error("rotation_drop_use_finalizeKeyRingAfterDrop");
    case "emergency":
      ring.replaceSigningSecret(nextSecret, 1);
      return;
    default: {
      const _exhaustive: never = step;
      throw new Error(`rotation_unknown_step:${String(_exhaustive)}`);
    }
  }
}

export function applyPepperRotationStep(ring: PepperRing, step: VersionedSecretRotationStep, nextPepper: string): void {
  applyKeyRingRotationStep(ring.asKeyRing(), step, nextPepper);
}

export function buildRotationPlan(input: {
  profile: VersionedSecretProfile;
  target: "preview" | "production";
  step: VersionedSecretRotationStep;
  snapshot: VersionedSecretEnvSnapshot;
  operatorIdentity?: string;
  secondaryValuePlaceholder?: string;
}): RotationPlan {
  const operatorIdentity = input.operatorIdentity ?? ROTATION_AGENT_OPERATOR_ID;
  const bindings = profileBindingsForTarget(input.profile, input.target);
  const ring = simulatedRingFromSnapshot(input.profile, input.snapshot);
  const stage = describeKeyRingState(ring).stage;
  const valuePlaceholder = input.secondaryValuePlaceholder ?? "<generated-secret>";
  const actions: WranglerSecretAction[] = [];
  const notes: string[] = [
    `Operator identity (audit): ${operatorIdentity}`,
    `Environment: ${input.target}`,
    `Profile: ${input.profile.id}`,
  ];

  switch (input.step) {
    case "stage": {
      if (!input.snapshot.primaryBound) {
        notes.push("Primary secret is not bound; use bootstrap or first-deploy scripts instead of overlap rotation.");
      }
      if (input.snapshot.secondaryBound) {
        notes.push(
          `${input.profile.secondarySecretName} is already bound; skip stage unless recovering from a bad state.`,
        );
      }
      for (const binding of bindings) {
        actions.push({
          type: "put",
          worker: binding.worker,
          name: input.profile.secondarySecretName,
          valuePlaceholder,
        });
      }
      notes.push(`Keep ${input.profile.kidVarName} at v1 on all Workers until stage completes.`);
      notes.push("After stage, run flip, then drain, then drop.");
      break;
    }
    case "flip": {
      if (!input.snapshot.secondaryBound) {
        notes.push(`Bind ${input.profile.secondarySecretName} on every Worker before flip.`);
      }
      for (const binding of bindings) {
        actions.push({
          type: "deploy-var",
          worker: binding.worker,
          cwd: `apps/${binding.app}`,
          envName: input.target,
          varName: input.profile.kidVarName,
          varValue: "v2",
        });
      }
      notes.push("New mints use kid 2; verifiers still accept kid 1 during overlap.");
      notes.push(`Next: drain — ${input.profile.drainHint}`);
      break;
    }
    case "drain": {
      notes.push(input.profile.drainHint);
      notes.push("Hosted smoke (preview/production) should pass before drop when credentials are approved.");
      notes.push("Record completion in the ops log with operator, timestamp, and verification command.");
      break;
    }
    case "drop": {
      if (!input.snapshot.secondaryBound) {
        notes.push(`${input.profile.secondarySecretName} must stay bound until drop completes.`);
      }
      if (profilePersistsKidInRecords(input.profile.id)) {
        for (const binding of bindings) {
          actions.push({
            type: "delete",
            worker: binding.worker,
            name: input.profile.baseSecretName,
          });
          actions.push({
            type: "deploy-var",
            worker: binding.worker,
            cwd: `apps/${binding.app}`,
            envName: input.target,
            varName: input.profile.kidVarName,
            varValue: "v2",
          });
        }
        notes.push(
          "Drop kid 1 only: delete the primary (kid 1) secret, keep _V2 and active kid v2. Stored pepper_kid / enc_kid values are not relabeled.",
        );
      } else {
        for (const binding of bindings) {
          actions.push({
            type: "put",
            worker: binding.worker,
            name: input.profile.baseSecretName,
            valuePlaceholder: `<promoted-${input.profile.secondarySecretName}>`,
          });
          actions.push({
            type: "deploy-var",
            worker: binding.worker,
            cwd: `apps/${binding.app}`,
            envName: input.target,
            varName: input.profile.kidVarName,
            varValue: "v1",
          });
          actions.push({
            type: "delete",
            worker: binding.worker,
            name: input.profile.secondarySecretName,
          });
        }
        notes.push("Promote the v2 value into the primary secret, reset kid to v1, deploy, verify, then delete _V2.");
      }
      break;
    }
    case "emergency": {
      for (const binding of bindings) {
        actions.push({
          type: "put",
          worker: binding.worker,
          name: input.profile.baseSecretName,
          valuePlaceholder,
        });
        actions.push({
          type: "deploy-var",
          worker: binding.worker,
          cwd: `apps/${binding.app}`,
          envName: input.target,
          varName: input.profile.kidVarName,
          varValue: "v1",
        });
        if (input.snapshot.secondaryBound) {
          actions.push({
            type: "delete",
            worker: binding.worker,
            name: input.profile.secondarySecretName,
          });
        }
      }
      notes.push("Emergency cutover invalidates overlap; use only when staging is not possible.");
      break;
    }
    default: {
      const _exhaustive: never = input.step;
      throw new Error(`rotation_unknown_step:${String(_exhaustive)}`);
    }
  }

  return {
    profileId: input.profile.id,
    step: input.step,
    stage,
    operatorIdentity,
    actions,
    notes,
  };
}

function simulatedRingFromSnapshot(profile: VersionedSecretProfile, snapshot: VersionedSecretEnvSnapshot): KeyRing {
  if (!snapshot.primaryBound) {
    return KeyRingClass.single("placeholder-primary", 1);
  }
  const signingKidLabel = snapshot.signingKidLabel ?? "v1";
  if (profile.id === "api-key-pepper") {
    const env: Record<string, string | undefined> = {
      API_KEY_PEPPER_V1: "primary",
      API_KEY_PEPPER_CURRENT_KID: signingKidLabel,
    };
    if (snapshot.secondaryBound || signingKidLabel === "v2") {
      env.API_KEY_PEPPER_V2 = "secondary";
    }
    return pepperRingFromProfileEnv(profile, env).asKeyRing();
  }
  const env: Record<string, string | undefined> = {
    [profile.baseSecretName]: "primary",
    [profile.kidVarName]: signingKidLabel,
  };
  if (snapshot.secondaryBound || signingKidLabel === "v2") {
    env[profile.secondarySecretName] = "secondary";
  }
  return keyRingFromProfileEnv(profile, env);
}

/** Signing-key drop: single primary secret at kid 1 with the promoted value (TTL-bound tokens only). */
export function collapseKeyRingAfterPromotion(ring: KeyRing): KeyRing {
  const promoted = ring.signingSecret();
  return KeyRingClass.single(promoted, 1);
}

/** Kid-persisting drop: retire kid 1 while mint/verify stay on kid 2 (ADR 0045). */
export function dropRetiredKidAfterPromotion(ring: KeyRing): KeyRing {
  const finalized = KeyRingClass.fromEntries(ring.signingKid, ring.verifyEntries());
  finalized.dropKid(1);
  return finalized;
}

export function finalizeKeyRingAfterDrop(ring: KeyRing, profileId: VersionedSecretProfileId): KeyRing {
  if (profilePersistsKidInRecords(profileId)) {
    return dropRetiredKidAfterPromotion(ring);
  }
  return collapseKeyRingAfterPromotion(ring);
}
