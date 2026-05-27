import type { BytePurgeMessage } from "@agent-paste/contracts";
import type { Env } from "./env.js";

export async function processSmokeSyncBytePurge(env: Env, message: BytePurgeMessage): Promise<void> {
  if (env.SMOKE_SYNC_BYTE_PURGE !== "true") {
    return;
  }

  const { handleQueueBatch } = await import("./queue.js");
  const ack = () => {};
  await handleQueueBatch(
    {
      queue: "byte-purge-preview",
      messages: [{ body: message, ack, retry: () => {} }],
    },
    env,
  );
}
