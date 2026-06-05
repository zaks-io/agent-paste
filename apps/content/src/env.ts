import type { RequestIdVariables } from "@agent-paste/auth";
import type { AnalyticsEngineDataset, BoundRespondersVariables } from "@agent-paste/worker-runtime";
import type { Context } from "hono";

export type R2ObjectBody = {
  body: ReadableStream | null;
  size: number;
  customMetadata?: Record<string, string>;
  httpMetadata?: {
    contentType?: string;
  };
  writeHttpMetadata?(headers: Headers): void;
};

export type R2Bucket = {
  get(key: string): Promise<R2ObjectBody | null>;
  head?(key: string): Promise<R2ObjectBody | null>;
};

export type KVNamespace = {
  get(key: string): Promise<string | null>;
};

export type RateLimitBinding = {
  limit(options: { key: string }): Promise<{ success: boolean }>;
};

export type Env = {
  ARTIFACTS: R2Bucket;
  DENYLIST: KVNamespace;
  ARTIFACT_RATE_LIMIT?: RateLimitBinding;
  CONTENT_SIGNING_SECRET: string;
  CONTENT_SIGNING_SECRET_V2?: string;
  CONTENT_SIGNING_KID?: string;
  ARTIFACT_BYTES_ENCRYPTION_KEY?: string;
  ARTIFACT_BYTES_ENCRYPTION_KEY_V2?: string;
  ARTIFACT_BYTES_ENCRYPTION_KID?: string;
  CONTENT_BASE_URL?: string;
  DOCS_BASE_URL?: string;
  AGENT_PASTE_ENV?: string;
  SENTRY_DSN?: string;
  ARTIFACT_EVENTS?: AnalyticsEngineDataset;
};

export type AppContext = Context<{ Bindings: Env; Variables: RequestIdVariables & BoundRespondersVariables }>;
