import type { RequestIdVariables, WebCallbackIdentity } from "@agent-paste/auth";
import type { ApiKeyActor, HyperdriveBinding, Repository } from "@agent-paste/db";
import type { AnalyticsEngineDataset, BoundRespondersVariables } from "@agent-paste/worker-runtime";
import type { Context } from "hono";

export type AuthService = {
  verifyApiKey(apiKey: string): Promise<ApiKeyActor | null>;
  verifyWebToken?(token: string): Promise<WebCallbackIdentity | null>;
};

export type ApiDatabase = Repository;

export type PaginationInput = {
  cursor?: string;
  limit: number;
};

export type R2ListedObject = { key: string };
export type R2Objects = { objects: R2ListedObject[]; truncated: boolean; cursor?: string };
export type R2Bucket = {
  list(options: { prefix?: string; cursor?: string; limit?: number }): Promise<R2Objects>;
  delete(keys: string | string[]): Promise<void>;
};

export type KVNamespace = {
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  get?(key: string): Promise<string | null>;
  delete(key: string): Promise<void>;
};

export type RateLimitBinding = {
  limit(options: { key: string }): Promise<{ success: boolean }>;
};

export type Env = {
  AUTH?: AuthService;
  DB?: Repository | HyperdriveBinding;
  ARTIFACTS?: R2Bucket;
  SMOKE_HARNESS_SECRET?: string;
  STREAM_INTERNAL_SECRET?: string;
  API_KEY_PEPPER_V1?: string;
  API_KEY_PEPPER_V2?: string;
  API_KEY_PEPPER_CURRENT_KID?: string;
  API_KEY_ENV?: "preview" | "production";
  CONTENT_SIGNING_SECRET_V2?: string;
  CONTENT_SIGNING_KID?: string;
  API_BASE_URL?: string;
  CONTENT_BASE_URL?: string;
  WEB_BASE_URL?: string;
  CONTENT_SIGNING_SECRET?: string;
  ACCESS_LINK_SIGNING_KEY_V1?: string;
  ACCESS_LINK_SIGNING_KEY_V2?: string;
  ACCESS_LINK_SIGNING_KID?: string;
  AGENT_VIEW_SIGNING_SECRET?: string;
  CLEANUP_BATCH_SIZE?: string;
  DENYLIST?: KVNamespace;
  CLI_RELEASE?: KVNamespace;
  ACTOR_RATE_LIMIT?: RateLimitBinding;
  WORKSPACE_BURST_CAP?: RateLimitBinding;
  ARTIFACT_RATE_LIMIT?: RateLimitBinding;
  EPHEMERAL_PROVISION_IP_RATE_LIMIT?: RateLimitBinding;
  EPHEMERAL_PROVISION_GLOBAL_RATE_LIMIT?: RateLimitBinding;
  EPHEMERAL_POW_SECRET?: string;
  BUNDLE_GENERATE_QUEUE?: { send(message: unknown): Promise<unknown> };
  SAFETY_SCAN_QUEUE?: { send(message: unknown): Promise<unknown> };
  BYTE_PURGE_QUEUE?: { send(message: unknown): Promise<unknown> };
  SYNC_BYTE_PURGE_DELETED_OBJECTS?: number;
  LOCAL_MVP_REPOSITORY?: {
    revisions: Map<string, { bytes_purge_enqueued_at?: string | null }>;
  };
  ARTIFACT_LIVE?: {
    idFromName(name: string): DurableObjectId;
    get(id: DurableObjectId): { fetch(request: Request): Promise<Response> };
  };
  WRITE_ALLOWANCE?: {
    idFromName(name: string): DurableObjectId;
    get(id: DurableObjectId): { fetch(request: Request): Promise<Response> };
  };
  AGENT_PASTE_ENV?: string;
  DOCS_BASE_URL?: string;
  WORKOS_API_KEY?: string;
  WORKOS_CLIENT_ID?: string;
  WORKOS_API_BASE_URL?: string;
  WORKOS_ISSUER?: string;
  WORKOS_JWKS_URL?: string;
  WORKOS_CLI_AUDIENCE?: string;
  WORKOS_CLI_JWKS_URL?: string;
  WORKOS_CLI_ISSUER?: string;
  WORKOS_MCP_AUDIENCE?: string;
  WORKOS_MCP_JWKS_URL?: string;
  WORKOS_MCP_ISSUER?: string;
  BILLING_ENABLED?: string;
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  SENTRY_DSN?: string;
  ARTIFACT_EVENTS?: AnalyticsEngineDataset;
};

export type AppContext = Context<{ Bindings: Env; Variables: RequestIdVariables & BoundRespondersVariables }>;
