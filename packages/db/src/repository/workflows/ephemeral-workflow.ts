import { IdempotencyInFlightError } from "@agent-paste/commands";
import { EPHEMERAL_AUTO_DELETION_DAYS } from "@agent-paste/config";
import { PepperRing } from "@agent-paste/rotation";
import { generateClaimToken, parseClaimToken, verifyClaimTokenSecret } from "../../claim-tokens.js";
import { createId } from "../../id.js";
import { artifactExpiresAtFromWorkspace, isEphemeralWorkspace } from "../../policy.js";
import { repositoryError } from "../../repository-error.js";
import type { ApiActor, ClaimToken, Workspace } from "../../types.js";
import type { RepositoryCoreContext } from "../core-context.js";
import {
  adminCommandActor,
  EPHEMERAL_PROVISION_SYSTEM_ACTOR,
  expiresAtFromSeconds,
  memberCommandActor,
  nowIso,
  PLATFORM_SCOPE,
  workspaceScope,
} from "../core-helpers.js";
import { buildApiKey } from "../shared.js";

/** Default claim-token lifetime for a freshly provisioned ephemeral workspace. */
const DEFAULT_CLAIM_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
const EPHEMERAL_CLAIM_OPERATION = "ephemeral.workspace.claim";

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
        public_id: generated.publicId,
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

export type ClaimEphemeralWorkspaceResult = {
  destination_workspace_id: string;
  source_workspace_id: string;
  artifact_ids: string[];
  claim_token_id: string;
};

async function resolveClaimTokenRecord(ctx: RepositoryCoreContext, claimTokenSecret: string): Promise<ClaimToken> {
  const parsed = parseClaimToken(claimTokenSecret);
  if (!parsed) {
    repositoryError("not_found");
  }
  const record = await ctx.uow.read(PLATFORM_SCOPE, (entities) => entities.claimTokens.findByPublicId(parsed.publicId));
  if (!record?.public_id) {
    repositoryError("not_found");
  }
  const pepper = ctx.pepperForRecord(record.pepper_kid);
  if (!pepper) {
    repositoryError("not_found");
  }
  const valid = await verifyClaimTokenSecret(claimTokenSecret, record.token_hash, pepper);
  if (!valid) {
    repositoryError("not_found");
  }
  return record;
}

function assertClaimTokenRedeemable(claimToken: ClaimToken, sourceWorkspace: Workspace, now: string) {
  if (claimToken.redeemed_at !== null) {
    repositoryError("not_found");
  }
  if (Date.parse(claimToken.expires_at) <= Date.parse(now)) {
    repositoryError("not_found");
  }
  if (!isEphemeralWorkspace(sourceWorkspace)) {
    repositoryError("not_found");
  }
}

export async function claimEphemeralWorkspace(
  ctx: RepositoryCoreContext,
  input: {
    actor: ApiActor;
    claimTokenSecret: string;
    idempotencyKey: string;
    now?: Date;
  },
): Promise<ClaimEphemeralWorkspaceResult> {
  return (await claimEphemeralWorkspaceWithReplayState(ctx, input)).result;
}

export async function claimEphemeralWorkspaceWithReplayState(
  ctx: RepositoryCoreContext,
  input: {
    actor: ApiActor;
    claimTokenSecret: string;
    idempotencyKey: string;
    now?: Date;
  },
): Promise<{ result: ClaimEphemeralWorkspaceResult; isReplay: boolean }> {
  if (input.actor.type !== "member") {
    repositoryError("forbidden");
  }
  const now = nowIso(input.now);
  const commandActor = memberCommandActor(input.actor);
  const replay = await ctx.uow.peekReplay<ClaimEphemeralWorkspaceResult>({
    actor: commandActor,
    operation: EPHEMERAL_CLAIM_OPERATION,
    idempotencyKey: input.idempotencyKey,
    scope: PLATFORM_SCOPE,
  });
  if (replay && "inFlight" in replay) {
    throw new IdempotencyInFlightError();
  }
  if (replay && "result" in replay) {
    return { result: replay.result, isReplay: true };
  }

  const claimToken = await resolveClaimTokenRecord(ctx, input.claimTokenSecret);
  const destinationWorkspaceId = input.actor.workspace_id;
  const sourceWorkspaceId = claimToken.workspace_id;

  await ctx.uow.read(PLATFORM_SCOPE, async (entities) => {
    const sourceWorkspace = await ctx.mustWorkspace(entities, sourceWorkspaceId);
    assertClaimTokenRedeemable(claimToken, sourceWorkspace, now);
    if (sourceWorkspaceId === destinationWorkspaceId) {
      repositoryError("not_found");
    }
  });

  const blobs = await ctx.uow.read(PLATFORM_SCOPE, (entities) =>
    entities.contentBlobs.listForReparent(sourceWorkspaceId, now),
  );
  if (blobs.length > 0) {
    if (!ctx.options.reparentBlobMigrator) {
      repositoryError("storage_unavailable");
    }
    await ctx.options.reparentBlobMigrator.migrate({
      fromWorkspaceId: sourceWorkspaceId,
      toWorkspaceId: destinationWorkspaceId,
      blobs,
    });
  }

  return ctx.uow.commandWithReplay(
    {
      actor: commandActor,
      operation: EPHEMERAL_CLAIM_OPERATION,
      idempotencyKey: input.idempotencyKey,
      scope: PLATFORM_SCOPE,
      now,
    },
    async (entities) => {
      const resolvedToken = await entities.claimTokens.findByPublicId(claimToken.public_id);
      if (!resolvedToken) {
        repositoryError("not_found");
      }
      const sourceWorkspace = await ctx.mustWorkspace(entities, resolvedToken.workspace_id);
      const destinationWorkspace = await ctx.mustWorkspace(entities, destinationWorkspaceId);
      assertClaimTokenRedeemable(resolvedToken, sourceWorkspace, now);
      if (sourceWorkspace.id === destinationWorkspace.id) {
        repositoryError("not_found");
      }

      const minArtifactExpiresAt = artifactExpiresAtFromWorkspace(destinationWorkspace, now);
      const artifactIds = await entities.artifacts.reparentWorkspace(
        sourceWorkspace.id,
        destinationWorkspace.id,
        minArtifactExpiresAt,
        now,
      );
      await entities.apiKeys.revokeAllForWorkspace(sourceWorkspace.id, now);
      const markedClaimed = await entities.workspaces.markClaimed(sourceWorkspace.id, {
        claimedAt: now,
        updatedAt: now,
      });
      if (!markedClaimed) {
        repositoryError("not_found");
      }
      const markedRedeemed = await entities.claimTokens.markRedeemed(resolvedToken.id, now);
      if (!markedRedeemed) {
        repositoryError("not_found");
      }

      await entities.operationEvents.insert({
        actorType: "member",
        actorId: input.actor.id,
        action: "ephemeral.workspace.claimed",
        targetType: "workspace",
        targetId: sourceWorkspace.id,
        workspaceId: destinationWorkspace.id,
        details: {
          claim_token_id: resolvedToken.id,
          source_workspace_id: sourceWorkspace.id,
          destination_workspace_id: destinationWorkspace.id,
          artifact_ids: artifactIds,
        },
        occurredAt: now,
      });

      return {
        destination_workspace_id: destinationWorkspace.id,
        source_workspace_id: sourceWorkspace.id,
        artifact_ids: artifactIds,
        claim_token_id: resolvedToken.id,
      };
    },
  );
}

export async function peekEphemeralClaimReplay(
  ctx: RepositoryCoreContext,
  input: { actor: ApiActor; idempotencyKey: string },
) {
  return ctx.uow.peekReplay<ClaimEphemeralWorkspaceResult>({
    actor: memberCommandActor(input.actor),
    operation: EPHEMERAL_CLAIM_OPERATION,
    idempotencyKey: input.idempotencyKey,
    scope: PLATFORM_SCOPE,
  });
}
