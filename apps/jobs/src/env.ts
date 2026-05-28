import type { HyperdriveBinding, SqlExecutor } from "@agent-paste/db";

export type R2ObjectBody = {
  body?: ReadableStream | ArrayBuffer | null;
  size?: number;
};

export type R2Bucket = {
  list(options: { prefix: string; cursor?: string }): Promise<{
    objects: Array<{ key: string }>;
    truncated: boolean;
    cursor?: string;
  }>;
  delete(keys: string[]): Promise<void>;
  get?(key: string): Promise<R2ObjectBody | null>;
  put?(
    key: string,
    value: ArrayBuffer | Uint8Array | ReadableStream,
    options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> },
  ): Promise<void>;
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
  SMOKE_HARNESS_SECRET?: string;
  SENTRY_DSN?: string;
  DB?: HyperdriveBinding | SqlExecutor;
  ARTIFACTS?: R2Bucket;
  ARTIFACT_BYTES_ENCRYPTION_KEY?: string;
  ARTIFACT_BYTES_ENCRYPTION_KEY_V2?: string;
  ARTIFACT_BYTES_ENCRYPTION_KID?: string;
  DENYLIST?: { put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> };
  BYTE_PURGE_QUEUE?: QueueBinding;
  SAFETY_SCAN_QUEUE?: QueueBinding;
  BUNDLE_GENERATE_QUEUE?: QueueBinding;
  /** Populated by the local sync queue harness to report deleted object counts. */
  SYNC_BYTE_PURGE_DELETED_OBJECTS?: number;
  /** When true, smoke harness enqueue paths drain byte purge immediately after send. */
  SMOKE_SYNC_BYTE_PURGE?: string;
  LOCAL_MVP_REPOSITORY?: {
    runCleanup(input: {
      actor: { type: string; id: string };
      dryRun: boolean;
      batchSize?: number;
      now: string;
    }): Promise<{ expired_artifacts: number; expired_artifact_ids?: string[] }>;
    artifacts: Map<string, { workspace_id: string; revision_id: string | null }>;
    revisions: Map<string, { bytes_purge_enqueued_at?: string | null }>;
  };
};

export function jobsEnabled(env: Env): boolean {
  return env.JOBS_ENABLED !== "false";
}
