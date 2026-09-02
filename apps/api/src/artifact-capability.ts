import type { ApiActor, Repository } from "@agent-paste/db";
import { captureWorkerError } from "@agent-paste/worker-runtime/logging";
import { signAgentViewContentUrls } from "./agent-view.js";
import type { Env } from "./env.js";

export async function refreshClaimedArtifactCapabilities(
  db: Repository,
  env: Env,
  actor: ApiActor,
  artifactIds: string[],
): Promise<void> {
  const results = await Promise.allSettled(
    artifactIds.map(async (artifactId) => {
      const detail = await db.getWebArtifact(actor, artifactId);
      if (!detail) {
        throw new Error(`Claimed Artifact ${artifactId} could not be loaded for capability refresh.`);
      }
      if (!detail.capability_view) {
        return;
      }
      await signAgentViewContentUrls(detail.capability_view, env, {
        workspaceId: actor.workspace_id,
        refreshCapabilityManifest: true,
      });
    }),
  );

  for (const [index, result] of results.entries()) {
    if (result.status === "fulfilled") {
      continue;
    }
    captureWorkerError({
      component: "api",
      event: "api.claimed_capability_refresh_failed",
      error: result.reason,
      environment: env.AGENT_PASTE_ENV,
      actorKind: actor.type,
      actorId: actor.id,
      workspaceId: actor.workspace_id,
      attributes: { artifact_id: artifactIds[index] },
    });
  }
  const failures = results.filter((result) => result.status === "rejected");
  if (failures.length > 0) {
    throw new AggregateError(
      failures.map((failure) => failure.reason),
      `Failed to refresh ${failures.length} claimed Artifact capability manifest(s).`,
    );
  }
}
