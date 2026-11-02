import { mintContentCapabilityId } from "@agent-paste/tokens/content-capability";
import { isEphemeralWorkspace } from "../../policy.js";
import { repositoryError } from "../../repository-error.js";
import type { RepositoryCoreContext } from "../core-context.js";
import { workspaceCommandActor, workspaceScope } from "../core-helpers.js";
import type { PersistentHostingRepository } from "../persistent-hosting-repository.js";
import { insertArtifactAuditEvent, mustActiveArtifact, nextArtifactUpdatedAt } from "./artifact-workflow-helpers.js";

export function setArtifactRetention(
  ctx: RepositoryCoreContext,
  i: Parameters<PersistentHostingRepository["setArtifactRetention"]>[0],
) {
  return ctx.uow.command(
    {
      actor: workspaceCommandActor(i.actor),
      operation: i.operation,
      idempotencyKey: i.idempotencyKey,
      scope: workspaceScope(i.actor.workspace_id),
      now: i.now,
    },
    async (e) => {
      await e.persistent.lockWorkspace(i.actor.workspace_id);
      const ws = await ctx.mustWorkspace(e, i.actor.workspace_id);
      if (isEphemeralWorkspace(ws)) repositoryError("forbidden");
      if (i.actor.type === "member") await ctx.mustMember(e, i.actor.id);
      await e.persistent.lockArtifact(i.artifactId, ws.id);
      const a = await mustActiveArtifact(e, {
        artifactId: i.artifactId,
        workspaceId: ws.id,
        requirePublishedRevision: i.pinned,
      });
      const policy = ctx.usagePolicyFor(ws);
      const updatedAt = nextArtifactUpdatedAt(a.updated_at, i.now);
      if (i.pinned) {
        const result = await e.artifacts.tryPinUnderCap(ws.id, a.id, i.now, updatedAt, policy.live_artifacts_cap);
        if (result === "cap_exceeded") repositoryError("pinned_artifact_cap_exceeded");
        if (result === "not_found") repositoryError("artifact_not_found");
        await e.artifacts.setPinnedAt(a.id, a.pinned_at ?? i.now, updatedAt);
      } else {
        await e.artifacts.updateExpiry(
          a.id,
          new Date(Date.parse(i.now) + policy.default_ttl_seconds * 1000).toISOString(),
        );
        await e.artifacts.setPinnedAt(a.id, null, updatedAt);
      }
      if (i.pinned)
        await insertArtifactAuditEvent(e, {
          actor: i.actor,
          action: "artifact.pinned",
          artifact: a,
          occurredAt: i.now,
        });
      else
        await insertArtifactAuditEvent(e, {
          actor: i.actor,
          action: "artifact.unpinned",
          artifact: a,
          occurredAt: i.now,
        });
      const result = await e.artifacts.findById(a.id, ws.id);
      if (!result) repositoryError("artifact_not_found");
      const capability =
        result.capability_id ?? (await e.artifacts.setCapabilityIdIfMissing(a.id, mintContentCapabilityId()));
      if (!capability) repositoryError("artifact_not_found");
      return {
        artifact_id: a.id,
        workspace_id: ws.id,
        capability_id: capability,
        retention: result.pinned_at ? ("pinned" as const) : ("temporary" as const),
        pinned_at: result.pinned_at,
        expires_at: result.expires_at,
        effective_expires_at: result.pinned_at ? null : result.expires_at,
        updated_at: result.updated_at,
        pinned_count: await e.artifacts.countPinned(ws.id),
        pin_allowance: policy.live_artifacts_cap,
      };
    },
  );
}
