import { z } from "./zod.js";

export const PowChallenge = z
  .object({
    nonce: z.string().min(1),
    difficulty: z.number().int().positive(),
    expires_at: z.string().datetime(),
    signature: z.string().min(1),
  })
  .strict();
export type PowChallenge = z.infer<typeof PowChallenge>;

export const PowSolution = z
  .object({
    nonce: z.string().min(1),
    counter: z.number().int().nonnegative(),
  })
  .strict();
export type PowSolution = z.infer<typeof PowSolution>;

/** POST body: omit or leave fields empty to receive a fresh challenge (pow_required). */
export const EphemeralProvisionRequest = z
  .object({
    challenge: PowChallenge.optional(),
    solution: PowSolution.optional(),
  })
  .strict();
export type EphemeralProvisionRequest = z.infer<typeof EphemeralProvisionRequest>;

export const EphemeralProvisionChallengeResponse = z
  .object({
    challenge: PowChallenge,
  })
  .strict();
export type EphemeralProvisionChallengeResponse = z.infer<typeof EphemeralProvisionChallengeResponse>;

export const EphemeralProvisionResponse = z
  .object({
    api_key_secret: z.string().min(1),
    claim_token: z.string().min(1),
    workspace_id: z.string().uuid(),
    api_key_id: z.string().min(1),
    claim_token_id: z.string().min(1),
  })
  .strict();
export type EphemeralProvisionResponse = z.infer<typeof EphemeralProvisionResponse>;
