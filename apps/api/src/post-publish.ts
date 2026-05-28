import {
  BundleGenerateMessage,
  DEFAULT_SAFETY_SCANNER_ID,
  DEFAULT_SAFETY_SCANNER_VERSION,
  SafetyScanMessage,
} from "@agent-paste/contracts";

type QueueBinding = {
  send(message: unknown): Promise<unknown>;
};

export type PostPublishEnv = {
  BUNDLE_GENERATE_QUEUE?: QueueBinding;
  SAFETY_SCAN_QUEUE?: QueueBinding;
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
  const sends: Promise<unknown>[] = [];
  const bundleQueue = env.BUNDLE_GENERATE_QUEUE as QueueBinding | undefined;
  if (input.bundleStatus === "pending" && bundleQueue) {
    const message = BundleGenerateMessage.parse({
      type: "bundle.generate.v1",
      workspace_id: input.workspaceId,
      artifact_id: input.artifactId,
      revision_id: input.revisionId,
      requested_at: input.requestedAt,
      reason: "publish",
    });
    sends.push(bundleQueue.send(message));
  }
  const safetyScanQueue = env.SAFETY_SCAN_QUEUE as QueueBinding | undefined;
  if (safetyScanQueue) {
    const message = SafetyScanMessage.parse({
      type: "safety.scan.v1",
      workspace_id: input.workspaceId,
      artifact_id: input.artifactId,
      revision_id: input.revisionId,
      scanner_id: DEFAULT_SAFETY_SCANNER_ID,
      scanner_version: DEFAULT_SAFETY_SCANNER_VERSION,
      requested_at: input.requestedAt,
    });
    sends.push(safetyScanQueue.send(message));
  }
  await Promise.all(sends);
}
