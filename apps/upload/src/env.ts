import type { RequestIdVariables } from "@agent-paste/auth";
import type { ApiActor, HyperdriveBinding, Repository } from "@agent-paste/db";
import type { BoundRespondersVariables } from "@agent-paste/worker-runtime";
import type { Context } from "hono";

export type UploadActor = ApiActor;

export type AuthService = {
  verifyApiKey(apiKey: string): Promise<Extract<UploadActor, { type: "api_key" }> | null>;
};

export type UploadFileInput = {
  path: string;
  size_bytes: number;
  sha256?: string;
};

export type { UploadSessionRecord } from "@agent-paste/db";

export type R2Object = {
  size: number;
};

export type R2Bucket = {
  put(
    key: string,
    value: ReadableStream | ArrayBuffer | Uint8Array | string | null,
    options?: { httpMetadata?: Record<string, string>; customMetadata?: Record<string, string> },
  ): Promise<unknown>;
  head(key: string): Promise<R2Object | null>;
};

export type RateLimitBinding = {
  limit(options: { key: string }): Promise<{ success: boolean }>;
};

export type Env = {
  AUTH?: AuthService;
  DB?: Repository | HyperdriveBinding;
  ARTIFACTS?: R2Bucket;
  API_KEY_PEPPER_V1?: string;
  API_KEY_PEPPER_V2?: string;
  API_KEY_PEPPER_CURRENT_KID?: string;
  API_KEY_ENV?: "preview" | "production";
  API_BASE_URL?: string;
  CONTENT_BASE_URL?: string;
  CONTENT_SIGNING_SECRET?: string;
  AGENT_VIEW_SIGNING_SECRET?: string;
  UPLOAD_SIGNING_SECRET?: string;
  UPLOAD_SIGNING_SECRET_V2?: string;
  UPLOAD_SIGNING_KID?: string;
  ARTIFACT_BYTES_ENCRYPTION_KEY?: string;
  ARTIFACT_BYTES_ENCRYPTION_KEY_V2?: string;
  ARTIFACT_BYTES_ENCRYPTION_KID?: string;
  UPLOAD_BASE_URL?: string;
  UPLOAD_URL_TTL_SECONDS?: string;
  ACTOR_RATE_LIMIT?: RateLimitBinding;
  WORKSPACE_BURST_CAP?: RateLimitBinding;
  DOCS_BASE_URL?: string;
  BILLING_ENABLED?: string;
  AGENT_PASTE_ENV?: string;
  SENTRY_DSN?: string;
  WORKOS_API_KEY?: string;
  WORKOS_API_BASE_URL?: string;
  WORKOS_MCP_AUDIENCE?: string;
  WORKOS_MCP_ISSUER?: string;
  WORKOS_MCP_JWKS_URL?: string;
  WORKOS_CLI_ISSUER?: string;
  WORKOS_CLI_JWKS_URL?: string;
};

export type AppContext = Context<{ Bindings: Env; Variables: RequestIdVariables & BoundRespondersVariables }>;
