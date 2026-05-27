import { BundleGenerateMessage } from "@agent-paste/contracts";

type QueueBinding = {
  send(message: unknown): Promise<unknown>;
};

export type PostPublishEnv = {
  BUNDLE_GENERATE_QUEUE?: QueueBinding;
};

export async function enqueuePostPublishJobs(
  env: PostPublishEnv,
  input: {
    workspaceId: string;
    artifactId: string;
    revisionId: string;
    bundleStatus: "pending" | "disabled";
    requestedAt: string;
  },
): Promise<void> {
  if (input.bundleStatus !== "pending") {
    return;
  }
  const queue = env.BUNDLE_GENERATE_QUEUE as QueueBinding | undefined;
  if (!queue) {
    return;
  }
  const message = BundleGenerateMessage.parse({
    type: "bundle.generate.v1",
    workspace_id: input.workspaceId,
    artifact_id: input.artifactId,
    revision_id: input.revisionId,
    requested_at: input.requestedAt,
    reason: "publish",
  });
  await queue.send(message);
}
