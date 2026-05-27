import { QUEUE_BUNDLE_GENERATE, QUEUE_BUNDLE_GENERATE_DLQ, QUEUE_BYTE_PURGE, QUEUE_SAFETY_SCAN } from "./constants.js";
import type { Env, QueueMessage } from "./env.js";
import { handleBundleGenerateBatch, handleBundleGenerateDlqBatch } from "./handlers/bundle-generate.js";
import { handleBytePurgeBatch } from "./handlers/byte-purge.js";
import { handleSafetyScanBatch } from "./handlers/safety-scan.js";
import { logOpError } from "./op-log.js";

export type MessageBatch = {
  readonly queue: string;
  readonly messages: readonly QueueMessage[];
};

export function normalizeQueueName(queue: string): string {
  return queue.replace(/-(?:preview(?:-pr-\d+)?|production)$/, "");
}

export async function handleQueueBatch(batch: MessageBatch, env: Env): Promise<void> {
  const queue = normalizeQueueName(batch.queue);
  switch (queue) {
    case QUEUE_BYTE_PURGE:
      await handleBytePurgeBatch(batch.messages, env);
      return;
    case QUEUE_SAFETY_SCAN:
      await handleSafetyScanBatch(batch.messages, env);
      return;
    case QUEUE_BUNDLE_GENERATE:
      await handleBundleGenerateBatch(batch.messages, env);
      return;
    case QUEUE_BUNDLE_GENERATE_DLQ:
      await handleBundleGenerateDlqBatch(batch.messages, env);
      return;
    default:
      logOpError("queue.unknown", { queue: batch.queue });
      for (const message of batch.messages) {
        message.retry();
      }
  }
}
