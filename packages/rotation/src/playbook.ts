import type { KeyRing } from "./key-ring.js";
import type { PepperRing } from "./pepper-ring.js";

/**
 * Documents the ADR 0045 staging-flip-drain sequence for operators and tests.
 * Each step mutates the ring in place; callers run assertions between steps.
 */
export type RotationStage = "verify-old" | "sign-new" | "drained";

export type RotationPlaybookState = {
  stage: RotationStage;
  overlapKids: readonly number[];
  signingKid: number;
};

export function describeKeyRingState(ring: KeyRing): RotationPlaybookState {
  const overlapKids = ring.verifyKids;
  const signingKid = ring.signingKid;
  if (overlapKids.length <= 1) {
    return { stage: "drained", overlapKids, signingKid };
  }
  const oldestKid = overlapKids[0] ?? signingKid;
  if (signingKid === oldestKid) {
    return { stage: "verify-old", overlapKids, signingKid };
  }
  return { stage: "sign-new", overlapKids, signingKid };
}

export function describePepperRingState(ring: PepperRing): RotationPlaybookState {
  return describeKeyRingState(ring.asKeyRing());
}
