import { BundleGenerateMessage } from "@agent-paste/contracts";
import { ZodError } from "zod";
import { markBundleFailed } from "../bundle/bundle-state.js";
import { resolveSqlExecutor, withWorkspaceScope } from "../db.js";
import type { Env, QueueMessage } from "../env.js";
import { logOpError } from "../op-log.js";
import { processBundleGenerateMessage } from "./bundle-generate-orchestration.js";

export async function handleBundleGenerateBatch(messages: readonly QueueMessage[], env: Env): Promise<void> {
  const executor = resolveSqlExecutor(env);
  if (!executor) {
    throw new Error("database_unavailable");
  }

  for (const message of messages) {
    try {
      const payload = BundleGenerateMessage.parse(message.body);
      await processBundleGenerateMessage(payload, env, executor);
      message.ack();
    } catch (error) {
      logOpError("queue.bundle_generate.failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      message.retry();
    }
  }
}

export async function handleBundleGenerateDlqBatch(messages: readonly QueueMessage[], env: Env): Promise<void> {
  const executor = resolveSqlExecutor(env);
  if (!executor) {
    throw new Error("database_unavailable");
  }

  for (const message of messages) {
    try {
      const payload = BundleGenerateMessage.parse(message.body);
      await markBundleFailed(
        withWorkspaceScope(executor, payload.workspace_id),
        payload.workspace_id,
        payload.revision_id,
      );
      logOpError("queue.bundle_generate.final_failure", {
        revision_id: payload.revision_id,
        workspace_id: payload.workspace_id,
        final_failure: true,
      });
      message.ack();
    } catch (error) {
      if (error instanceof ZodError) {
        logOpError("queue.bundle_generate.dlq_invalid", {
          error: error.message,
        });
        message.ack();
        continue;
      }
      logOpError("queue.bundle_generate.dlq_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      message.retry();
    }
  }
}
