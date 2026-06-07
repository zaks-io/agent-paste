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

/**
 * POST body for ephemeral provision. Send `{}` or omit challenge/solution fields to
 * receive a fresh PoW challenge (`401` `pow_required`). An empty request body is also
 * accepted and treated the same as `{}`.
 */
export const EphemeralProvisionRequest = z
  .object({
    challenge: PowChallenge.optional(),
    solution: PowSolution.optional(),
  })
  .strict();
export type EphemeralProvisionRequest = z.infer<typeof EphemeralProvisionRequest>;

export const EphemeralPowRequiredResponse = z
  .object({
    error: z.object({
      code: z.literal("pow_required"),
      message: z.string(),
      docs: z.string().url().optional(),
      request_id: z.string().min(1).optional(),
    }),
    challenge: PowChallenge,
  })
  .strict();
export type EphemeralPowRequiredResponse = z.infer<typeof EphemeralPowRequiredResponse>;

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

export const EphemeralClaimRequest = z
  .object({
    claim_token: z.string().min(1),
  })
  .strict();
export type EphemeralClaimRequest = z.infer<typeof EphemeralClaimRequest>;

export const EphemeralClaimResponse = z
  .object({
    destination_workspace_id: z.string().uuid(),
    source_workspace_id: z.string().uuid(),
    artifact_ids: z.array(z.string().min(1)).max(100),
    claim_token_id: z.string().min(1),
  })
  .strict();
export type EphemeralClaimResponse = z.infer<typeof EphemeralClaimResponse>;
