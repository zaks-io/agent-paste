import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import {
  CleanupRunRequest,
  CleanupRunResponse,
  CreateWorkspaceRequest,
  OperationEvent,
  OperationEventListResponse,
  RevokeApiKeyResponse,
  WorkspaceDetail,
  WorkspaceListResponse,
} from "../admin.js";
import { AgentView } from "../agentView.js";
import { ApiKeySummary, CreateApiKeyRequest, CreateApiKeyResponse } from "../apiKeys.js";
import { ArtifactDetail, ArtifactListResponse, ArtifactSummary, DeleteArtifactResponse } from "../artifacts.js";
import { EmptyObject, ErrorEnvelope } from "../common.js";
import { LockdownDetail, LockdownListResponse, SetLockdownRequest } from "../lockdown.js";
import { CreateUploadSessionRequest, CreateUploadSessionResponse, PublishResult } from "../uploadSessions.js";
import {
  UpdateWebSettingsRequest,
  WebApiKeyListResponse,
  WebArtifactDetailResponse,
  WebArtifactListResponse,
  WebArtifactRow,
  WebAuditListResponse,
  WebAuditRow,
  WebAuthCallbackResponse,
  WebSettingsResponse,
  WebWorkspaceResponse,
  WorkspaceMemberSummary,
} from "../web.js";
import { UsagePolicy, WhoamiResponse } from "../workspace.js";
import { z } from "../zod.js";

export function registerSharedSchemas(registry: OpenAPIRegistry): void {
  registry.register("ErrorEnvelope", ErrorEnvelope);
}

export function registerApiSchemas(registry: OpenAPIRegistry): void {
  registerSharedSchemas(registry);
  registry.register("WhoamiResponse", WhoamiResponse);
  registry.register("UsagePolicy", UsagePolicy);
  registry.register("AgentView", AgentView);
  registry.register("WorkspaceDetail", WorkspaceDetail);
  registry.register("WorkspaceListResponse", WorkspaceListResponse);
  registry.register("CreateWorkspaceRequest", CreateWorkspaceRequest);
  registry.register("CreateApiKeyRequest", CreateApiKeyRequest);
  registry.register("CreateApiKeyResponse", CreateApiKeyResponse);
  registry.register("ApiKeySummary", ApiKeySummary);
  registry.register("RevokeApiKeyResponse", RevokeApiKeyResponse);
  registry.register("ArtifactSummary", ArtifactSummary);
  registry.register("ArtifactDetail", ArtifactDetail);
  registry.register("ArtifactListResponse", ArtifactListResponse);
  registry.register("DeleteArtifactResponse", DeleteArtifactResponse);
  registry.register("CleanupRunRequest", CleanupRunRequest);
  registry.register("CleanupRunResponse", CleanupRunResponse);
  registry.register("OperationEvent", OperationEvent);
  registry.register("OperationEventListResponse", OperationEventListResponse);
  registry.register("WorkspaceMemberSummary", WorkspaceMemberSummary);
  registry.register("WebAuthCallbackResponse", WebAuthCallbackResponse);
  registry.register("WebWorkspaceResponse", WebWorkspaceResponse);
  registry.register("WebArtifactRow", WebArtifactRow);
  registry.register("WebArtifactListResponse", WebArtifactListResponse);
  registry.register("WebArtifactDetailResponse", WebArtifactDetailResponse);
  registry.register("WebApiKeyListResponse", WebApiKeyListResponse);
  registry.register("WebAuditRow", WebAuditRow);
  registry.register("WebAuditListResponse", WebAuditListResponse);
  registry.register("WebSettingsResponse", WebSettingsResponse);
  registry.register("UpdateWebSettingsRequest", UpdateWebSettingsRequest);
  registry.register("SetLockdownRequest", SetLockdownRequest);
  registry.register("LockdownDetail", LockdownDetail);
  registry.register("LockdownListResponse", LockdownListResponse);
}

export function registerUploadSchemas(registry: OpenAPIRegistry): void {
  registerSharedSchemas(registry);
  registry.register("CreateUploadSessionRequest", CreateUploadSessionRequest);
  registry.register("CreateUploadSessionResponse", CreateUploadSessionResponse);
  registry.register("PublishResult", PublishResult);
  registry.register("EmptyObject", EmptyObject);
}

export function registerContentSchemas(registry: OpenAPIRegistry): void {
  registerSharedSchemas(registry);
}

export const securitySchemes = {
  ApiKeyBearer: {
    type: "http",
    scheme: "bearer",
    description: "Workspace API key (prefix ap_pk_).",
  },
  AdminBearer: {
    type: "http",
    scheme: "bearer",
    description: "Operator admin token.",
  },
  WorkOsBearer: {
    type: "http",
    scheme: "bearer",
    description: "WorkOS AuthKit access token forwarded by the web Worker.",
  },
  CfAccessServiceToken: {
    type: "apiKey",
    in: "header",
    name: "Cf-Access-Jwt-Assertion",
    description: "Cloudflare Access service-token JWT (rotation agent machine identity).",
  },
} as const;

export const idempotencyKeyHeader = z
  .string()
  .min(8)
  .max(200)
  .openapi({
    param: { name: "Idempotency-Key", in: "header", required: true },
    description: "Caller-provided idempotency key. Required on every mutation.",
  });

export const requestIdHeader = z
  .string()
  .min(8)
  .max(128)
  .optional()
  .openapi({
    param: { name: "X-Request-Id", in: "header", required: false },
    description: "Caller-supplied request id. Worker echoes it back; non-matching values are replaced with a UUID.",
  });

export type OpenApiVersion = "3.1.0";

export type OpenApiInfo = {
  title: string;
  version: string;
  description?: string;
};

export type OpenApiServer = {
  url: string;
  description?: string;
};
