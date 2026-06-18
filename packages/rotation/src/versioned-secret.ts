import type { RotationStage } from "./playbook.js";

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
