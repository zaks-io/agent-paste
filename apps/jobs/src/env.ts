import type { HyperdriveBinding, SqlExecutor } from "@agent-paste/db";

export type R2Bucket = {
  list(options: { prefix: string; cursor?: string }): Promise<{
    objects: Array<{ key: string }>;
    truncated: boolean;
    cursor?: string;
  }>;
  delete(keys: string[]): Promise<void>;
};

export type QueueBinding = {
  send(message: unknown, options?: { delaySeconds?: number }): Promise<unknown>;
  sendBatch(messages: Iterable<{ body: unknown }>): Promise<unknown>;
};

export type QueueMessage = {
  readonly body: unknown;
  ack(): void;
  retry(): void;
};

export type Env = {
  AGENT_PASTE_ENV?: string;
  JOBS_ENABLED?: string;
  SENTRY_DSN?: string;
  DB?: HyperdriveBinding | SqlExecutor;
  ARTIFACTS?: R2Bucket;
  DENYLIST?: { put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> };
  BYTE_PURGE_QUEUE?: QueueBinding;
  SAFETY_SCAN_QUEUE?: QueueBinding;
  BUNDLE_GENERATE_QUEUE?: QueueBinding;
};

export function jobsEnabled(env: Env): boolean {
  return env.JOBS_ENABLED !== "false";
}
