import { OptionalClaimCodeInput } from "./primitives.js";
import { z } from "./zod.js";

export const EphemeralProvisionRequest = z
  .object({
    claim_code: OptionalClaimCodeInput,
  })
  .strict();
export type EphemeralProvisionRequest = z.infer<typeof EphemeralProvisionRequest>;

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
