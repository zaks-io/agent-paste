import { BundleGenerateMessage } from "@agent-paste/contracts";
import type { Env } from "../env.js";
import { logOp, logOpError } from "../op-log.js";

export async function enqueueBundleGenerate(
  env: Env,
  input: {
    workspaceId: string;
    artifactId: string;
    revisionId: string;
    requestedAt: string;
  },
): Promise<boolean> {
  if (!env.BUNDLE_GENERATE_QUEUE) {
    logOpError("lifecycle.bundle_generate.queue_missing", { revision_id: input.revisionId });
    return false;
  }

  const message = BundleGenerateMessage.parse({
    type: "bundle.generate.v1",
    workspace_id: input.workspaceId,
    artifact_id: input.artifactId,
    revision_id: input.revisionId,
    requested_at: input.requestedAt,
    reason: "publish",
  });

  try {
    await env.BUNDLE_GENERATE_QUEUE.send(message);
    logOp("lifecycle.bundle_generate.enqueued", {
      revision_id: input.revisionId,
      artifact_id: input.artifactId,
    });
    return true;
  } catch (error) {
    logOpError("lifecycle.bundle_generate.enqueue_failed", {
      revision_id: input.revisionId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
