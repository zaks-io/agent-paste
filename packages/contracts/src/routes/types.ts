import type { ErrorCode } from "../common.js";
import type { Scope } from "../enums.js";
import type { z } from "../zod.js";
import type { RequestSchemaName, requestSchemas } from "./request-schemas.js";

export type AppSurface = "api" | "upload" | "content";
export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE" | "PUT" | "HEAD";
export type AuthRequirement =
  | "none"
  | "api_key"
  | "api_key_or_mcp_oauth"
  | "mcp_oauth"
  | "workos_access_token"
  | "operator"
  | "signed_agent_view_token"
  | "signed_upload_url"
  | "signed_content_token";
export type IdempotencyRequirement = "none" | "required";
export type RateLimitRequirement = "none" | "actor" | "artifact" | "ephemeral_provision";

export type RouteContract = {
  id: string;
  app: AppSurface;
  method: HttpMethod;
  path: string;
  auth: AuthRequirement;
  scopes: readonly Scope[];
  idempotency: IdempotencyRequirement;
  rateLimit: RateLimitRequirement;
  allowUnprovisioned?: boolean;
  /** When true, an empty request body is parsed as `{}` before schema validation. */
  allowEmptyBody?: boolean;
  requestSchema?: RequestSchemaName;
  responseSchema: string;
  errors: readonly ErrorCode[];
};

export type RequestBodyFor<Contract extends RouteContract> = Contract extends { requestSchema: infer Name }
  ? Name extends RequestSchemaName
    ? z.infer<(typeof requestSchemas)[Name]>
    : never
  : undefined;
