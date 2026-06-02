import { EPHEMERAL_AUTO_DELETION_DAYS } from "@agent-paste/config";
import { PepperRing } from "@agent-paste/rotation";
import { generateClaimToken } from "../../claim-tokens.js";
import { createId } from "../../id.js";
import type { ClaimToken, Workspace } from "../../types.js";
import type { RepositoryCoreContext } from "../core-context.js";
import {
  adminCommandActor,
  EPHEMERAL_PROVISION_SYSTEM_ACTOR,
  expiresAtFromSeconds,
  nowIso,
  workspaceScope,
} from "../core-helpers.js";
import { buildApiKey } from "../shared.js";

/** Default claim-token lifetime for a freshly provisioned ephemeral workspace. */
const DEFAULT_CLAIM_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

export type CreateEphemeralWorkspaceResult = {
  workspace: Workspace;
  api_key: Awaited<ReturnType<typeof buildApiKey>>["apiKey"];
  api_key_secret: string;
  claim_token: ClaimToken;
  claim_token_secret: string;
};

export async function createEphemeralWorkspace(
  ctx: RepositoryCoreContext,
  input: {
    idempotencyKey: string;
    now?: Date;
    claimTokenExpiresInSeconds?: number;
  },
): Promise<CreateEphemeralWorkspaceResult> {
  const now = nowIso(input.now);
  const workspaceId = crypto.randomUUID();
  const workspace: Workspace = {
    id: workspaceId,
    name: "Ephemeral workspace",
    contact_email: null,
    plan: "free",
    plan_operator_override_at: null,
    claimed_at: null,
    auto_deletion_days: EPHEMERAL_AUTO_DELETION_DAYS,
    revision_retention_days: null,
    created_at: now,
    updated_at: now,
  };
  const claimExpiresAt =
    expiresAtFromSeconds(now, input.claimTokenExpiresInSeconds ?? DEFAULT_CLAIM_TOKEN_TTL_SECONDS) ?? now;

  return ctx.uow.command(
    {
      actor: adminCommandActor(EPHEMERAL_PROVISION_SYSTEM_ACTOR, workspaceId),
      operation: "ephemeral.workspace.provision",
      idempotencyKey: input.idempotencyKey,
      scope: workspaceScope(workspaceId),
      now,
    },
    async (entities) => {
      await entities.workspaces.insert(workspace);

      const { apiKey, secret: apiKeySecret } = await buildApiKey(ctx.options, {
        workspaceId,
        name: "Ephemeral publish key",
        now,
        expiresAt: claimExpiresAt,
      });
      await entities.apiKeys.insert(apiKey);

      const pepperRing = ctx.options.pepperRing ?? PepperRing.single(ctx.options.apiKeyPepper, 1);
      const generated = await generateClaimToken(ctx.options.apiKeyEnv ?? "preview", pepperRing.currentPepper());
      const claimToken: ClaimToken = {
        id: createId("ct"),
        workspace_id: workspaceId,
        token_hash: generated.tokenHash,
        pepper_kid: pepperRing.currentKid,
        expires_at: claimExpiresAt,
        redeemed_at: null,
        created_at: now,
      };
      await entities.claimTokens.insert(claimToken);

      await entities.operationEvents.insert({
        actorType: EPHEMERAL_PROVISION_SYSTEM_ACTOR.type,
        actorId: EPHEMERAL_PROVISION_SYSTEM_ACTOR.id,
        action: "ephemeral.workspace.provisioned",
        targetType: "workspace",
        targetId: workspaceId,
        workspaceId,
        details: { claim_token_id: claimToken.id, api_key_id: apiKey.id },
        occurredAt: now,
      });

      return {
        workspace,
        api_key: apiKey,
        api_key_secret: apiKeySecret,
        claim_token: claimToken,
        claim_token_secret: generated.secret,
      };
    },
  );
}
