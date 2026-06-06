import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import {
  AccessLinkResolveRequest,
  AccessLinkSignedUrl,
  CreateAccessLinkRequest,
  CreateAccessLinkResponse,
} from "../accessLinks.js";
import { RevokeApiKeyResponse } from "../admin.js";
import { AgentView, PublicAgentView } from "../agentView.js";
import { ApiKeySummary, CreateApiKeyRequest, CreateApiKeyResponse } from "../apiKeys.js";
import { ArtifactDetail, ArtifactListResponse, ArtifactSummary, DeleteArtifactResponse } from "../artifacts.js";
import {
  BillingInvoiceListResponse,
  BillingStatusResponse,
  CheckoutSessionResponse,
  CreateCheckoutSessionRequest,
  PortalSessionResponse,
  SetWorkspacePlanRequest,
  WebhookReceivedResponse,
} from "../billing.js";
import {
  BundleAvailability,
  BundleAvailabilityDisabled,
  BundleAvailabilityFailed,
  BundleAvailabilityPending,
  BundleAvailabilityReady,
} from "../bundle.js";
import { CliVersionResponse } from "../cliVersion.js";
import { EmptyObject, ErrorEnvelope } from "../common.js";
import {
  EphemeralClaimRequest,
  EphemeralClaimResponse,
  EphemeralPowRequiredResponse,
  EphemeralProvisionChallengeResponse,
  EphemeralProvisionRequest,
  EphemeralProvisionResponse,
  PowChallenge,
} from "../ephemeral.js";
import { LockdownDetail, LockdownListResponse, SetLockdownRequest } from "../lockdown.js";
import { McpWhoamiResponse } from "../mcp.js";
import { PlainTextTitle, UrlString } from "../primitives.js";
import { RenderMode, RevisionListResponse, RevisionSummary } from "../revisions.js";
import {
  CreateUploadSessionRequest,
  CreateUploadSessionResponse,
  FinalizeUploadSessionResponse,
  PublishResult,
} from "../uploadSessions.js";
import {
  UpdateWebSettingsRequest,
  WebAccessLinkListResponse,
  WebAccessLinkRow,
  WebApiKeyListResponse,
  WebArtifactDetailResponse,
  WebArtifactListResponse,
  WebArtifactRow,
  WebAuditListResponse,
  WebAuditRow,
  WebAuthCallbackResponse,
  WebOperatorEventListResponse,
  WebOperatorEventRow,
  WebRevokeAccessLinkResponse,
  WebSettingsResponse,
  WebWorkspaceResponse,
  WorkspaceMemberSummary,
} from "../web.js";
import { UsagePolicy, WhoamiResponse } from "../workspace.js";
import { z } from "../zod.js";

export function registerSharedSchemas(registry: OpenAPIRegistry): void {
  registry.register("ErrorEnvelope", ErrorEnvelope);
}

function registerBundleAvailabilitySchemas(registry: OpenAPIRegistry): void {
  registry.register("BundleAvailabilityPending", BundleAvailabilityPending);
  registry.register("BundleAvailabilityReady", BundleAvailabilityReady);
  registry.register("BundleAvailabilityFailed", BundleAvailabilityFailed);
  registry.register("BundleAvailabilityDisabled", BundleAvailabilityDisabled);
  registry.register("BundleAvailability", BundleAvailability);
}

export function registerApiSchemas(registry: OpenAPIRegistry): void {
  registerSharedSchemas(registry);
  registerBundleAvailabilitySchemas(registry);
  registry.register("WhoamiResponse", WhoamiResponse);
  registry.register("McpWhoamiResponse", McpWhoamiResponse);
  registry.register("UsagePolicy", UsagePolicy);
  registry.register("CliVersionResponse", CliVersionResponse);
  const registeredPublicAgentView = registry.register("PublicAgentView", PublicAgentView);
  registry.register("AgentView", AgentView);
  registry.register("AccessLinkResolveRequest", AccessLinkResolveRequest);
  registry.register("PowChallenge", PowChallenge);
  registry.register("EphemeralProvisionRequest", EphemeralProvisionRequest);
  registry.register("EphemeralPowRequiredResponse", EphemeralPowRequiredResponse);
  registry.register("EphemeralProvisionChallengeResponse", EphemeralProvisionChallengeResponse);
  registry.register("EphemeralProvisionResponse", EphemeralProvisionResponse);
  registry.register("EphemeralClaimRequest", EphemeralClaimRequest);
  registry.register("EphemeralClaimResponse", EphemeralClaimResponse);
  registry.register(
    "AccessLinkResolveResponse",
    z.object({
      agent_view: registeredPublicAgentView,
      render_mode: RenderMode,
      iframe_src: UrlString,
      title: PlainTextTitle,
    }),
  );
  registry.register("CreateApiKeyRequest", CreateApiKeyRequest);
  registry.register("CreateApiKeyResponse", CreateApiKeyResponse);
  registry.register("ApiKeySummary", ApiKeySummary);
  registry.register("RevokeApiKeyResponse", RevokeApiKeyResponse);
  registry.register("ArtifactSummary", ArtifactSummary);
  registry.register("ArtifactDetail", ArtifactDetail);
  registry.register("ArtifactListResponse", ArtifactListResponse);
  registry.register("DeleteArtifactResponse", DeleteArtifactResponse);
  registry.register("WorkspaceMemberSummary", WorkspaceMemberSummary);
  registry.register("WebAuthCallbackResponse", WebAuthCallbackResponse);
  registry.register("WebWorkspaceResponse", WebWorkspaceResponse);
  registry.register("WebArtifactRow", WebArtifactRow);
  registry.register("WebArtifactListResponse", WebArtifactListResponse);
  registry.register("WebArtifactDetailResponse", WebArtifactDetailResponse);
  registry.register("WebApiKeyListResponse", WebApiKeyListResponse);
  registry.register("CreateAccessLinkRequest", CreateAccessLinkRequest);
  registry.register("CreateAccessLinkResponse", CreateAccessLinkResponse);
  registry.register("AccessLinkSignedUrl", AccessLinkSignedUrl);
  registry.register("WebAccessLinkRow", WebAccessLinkRow);
  registry.register("WebAccessLinkListResponse", WebAccessLinkListResponse);
  registry.register("WebRevokeAccessLinkResponse", WebRevokeAccessLinkResponse);
  registry.register("RevisionSummary", RevisionSummary);
  registry.register("RevisionListResponse", RevisionListResponse);
  registry.register("WebAuditRow", WebAuditRow);
  registry.register("WebAuditListResponse", WebAuditListResponse);
  registry.register("WebOperatorEventRow", WebOperatorEventRow);
  registry.register("WebOperatorEventListResponse", WebOperatorEventListResponse);
  registry.register("WebSettingsResponse", WebSettingsResponse);
  registry.register("UpdateWebSettingsRequest", UpdateWebSettingsRequest);
  registry.register("SetLockdownRequest", SetLockdownRequest);
  registry.register("LockdownDetail", LockdownDetail);
  registry.register("LockdownListResponse", LockdownListResponse);
  registry.register("CreateCheckoutSessionRequest", CreateCheckoutSessionRequest);
  registry.register("CheckoutSessionResponse", CheckoutSessionResponse);
  registry.register("PortalSessionResponse", PortalSessionResponse);
  registry.register("BillingStatusResponse", BillingStatusResponse);
  registry.register("BillingInvoiceListResponse", BillingInvoiceListResponse);
  registry.register("WebhookReceivedResponse", WebhookReceivedResponse);
  registry.register("SetWorkspacePlanRequest", SetWorkspacePlanRequest);
}

export function registerUploadSchemas(registry: OpenAPIRegistry): void {
  registerSharedSchemas(registry);
  registerBundleAvailabilitySchemas(registry);
  registry.register("CreateUploadSessionRequest", CreateUploadSessionRequest);
  registry.register("CreateUploadSessionResponse", CreateUploadSessionResponse);
  registry.register("FinalizeUploadSessionResponse", FinalizeUploadSessionResponse);
  registry.register("PublishResult", PublishResult);
  registry.register("RevisionSummary", RevisionSummary);
  registry.register("RevisionListResponse", RevisionListResponse);
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
  WorkOsBearer: {
    type: "http",
    scheme: "bearer",
    description: "WorkOS AuthKit access token forwarded by the web Worker.",
  },
  McpOAuthBearer: {
    type: "http",
    scheme: "bearer",
    description: "WorkOS AuthKit/Connect access token minted for the MCP resource indicator.",
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
