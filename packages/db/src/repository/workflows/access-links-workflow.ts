import { assertAccessLinkMintable, createAccessLinkRow, mintAccessLinkSignedUrl } from "../../access-links.js";
import { repositoryError } from "../../repository-error.js";
import { resolveAccessLinkFromEntities } from "../../resolve-access-link.js";
import type { ApiActor } from "../../types.js";
import type { RepositoryCoreContext } from "../core-context.js";
import { nowIso, PLATFORM_SCOPE, workspaceCommandActor, workspaceScope } from "../core-helpers.js";

export async function resolveAccessLink(
  ctx: RepositoryCoreContext,
  input: { publicId: string; blobScopes: number; contentBaseUrl: string; now?: string },
) {
  return ctx.uow.read(PLATFORM_SCOPE, async (entities) => resolveAccessLinkFromEntities(entities, input));
}

export async function createMemberAccessLink(
  ctx: RepositoryCoreContext,
  input: {
    actor: ApiActor;
    idempotencyKey: string;
    artifactId: string;
    type: import("../../types.js").AccessLink["type"];
    revisionId?: string | null;
    now?: Date;
  },
) {
  const now = nowIso(input.now);
  return ctx.uow.command(
    {
      actor: workspaceCommandActor(input.actor),
      operation: "access_link.create",
      idempotencyKey: input.idempotencyKey,
      scope: workspaceScope(input.actor.workspace_id),
      now,
    },
    async (entities) => {
      const artifact = await entities.artifacts.findById(input.artifactId, input.actor.workspace_id);
      if (!artifact || artifact.status !== "active" || !artifact.revision_id) {
        repositoryError("artifact_not_found");
      }
      const revisionId = input.type === "revision" ? (input.revisionId ?? null) : null;
      if (input.type === "revision") {
        const revision = revisionId ? await entities.revisions.findById(revisionId, input.actor.workspace_id) : null;
        if (!revision || revision.artifact_id !== artifact.id || revision.status !== "published") {
          repositoryError("not_found");
        }
      }
      const link = createAccessLinkRow({
        workspaceId: input.actor.workspace_id,
        artifactId: artifact.id,
        type: input.type,
        revisionId,
        createdByType: input.actor.type === "member" ? "member" : "api_key",
        createdById: input.actor.id,
        now,
      });
      await entities.accessLinks.insert(link);
      return {
        id: link.id,
        type: link.type,
        artifact_id: link.artifact_id,
        revision_id: link.revision_id,
        created_at: link.created_at,
      };
    },
  );
}

export async function listMemberAccessLinks(ctx: RepositoryCoreContext, actor: ApiActor, artifactId: string) {
  return ctx.uow.read(workspaceScope(actor.workspace_id), async (entities) => {
    const artifact = await entities.artifacts.findById(artifactId, actor.workspace_id);
    if (!artifact) {
      return null;
    }
    const links = await entities.accessLinks.listForArtifact(artifact.id);
    return {
      artifact_id: artifact.id,
      items: links.map((link) => ({
        id: link.id,
        type: link.type,
        artifact_id: link.artifact_id,
        revision_id: link.revision_id,
        created_at: link.created_at,
        expires_at: link.expires_at,
        revoked_at: link.revoked_at,
      })),
    };
  });
}

export async function revokeMemberAccessLink(
  ctx: RepositoryCoreContext,
  input: { actor: ApiActor; accessLinkId: string; now?: Date },
) {
  const now = nowIso(input.now);
  return ctx.uow.command(
    {
      actor: workspaceCommandActor(input.actor),
      operation: "access_link.revoke",
      idempotencyKey: `access-link:revoke:${input.accessLinkId}`,
      scope: workspaceScope(input.actor.workspace_id),
      now,
    },
    async (entities) => {
      const link = await entities.accessLinks.findById(input.accessLinkId, input.actor.workspace_id);
      if (!link) {
        repositoryError("not_found");
      }
      const revoked = await entities.accessLinks.revoke(link.id, now);
      if (!revoked) {
        repositoryError("not_found");
      }
      return { access_link_id: link.id, revoked_at: now };
    },
  );
}

export async function mintMemberAccessLink(
  ctx: RepositoryCoreContext,
  input: {
    actor: ApiActor;
    accessLinkId: string;
    appBaseUrl: string;
    signingSecret: string;
    signingKid: number;
    now?: Date;
  },
) {
  const now = nowIso(input.now);
  return ctx.uow.read(workspaceScope(input.actor.workspace_id), async (entities) => {
    const link = await entities.accessLinks.findById(input.accessLinkId, input.actor.workspace_id);
    if (!link) {
      repositoryError("not_found");
    }
    const artifact = await entities.artifacts.findById(link.artifact_id, input.actor.workspace_id);
    assertAccessLinkMintable(link, artifact, new Date(now));
    const minted = await mintAccessLinkSignedUrl({
      link,
      artifact,
      appBaseUrl: input.appBaseUrl,
      signingSecret: input.signingSecret,
      signingKid: input.signingKid,
      now: new Date(now),
    });
    return { url: minted.url };
  });
}
