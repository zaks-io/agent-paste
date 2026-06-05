import { SafetyScanMessage } from "@agent-paste/contracts";
import { resolveSqlExecutor } from "../db.js";
import type { Env, QueueMessage } from "../env.js";
import { logOpError } from "../op-log.js";
import { processSafetyScanMessage } from "./safety-scan-orchestration.js";

export async function handleSafetyScanBatch(messages: readonly QueueMessage[], env: Env): Promise<void> {
  const executor = resolveSqlExecutor(env);
  if (!executor) {
    throw new Error("database_unavailable");
  }

  for (const message of messages) {
    try {
      const payload = SafetyScanMessage.parse(message.body);
      await processSafetyScanMessage(payload, env, executor);
      message.ack();
    } catch (error) {
      logOpError("queue.safety_scan.failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      message.retry();
    }
  }
}
