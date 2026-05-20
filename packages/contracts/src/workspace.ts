import { z } from "zod";
import { ActorType, AuthAudience, Scope } from "./enums.js";
import { IsoDateTime, WorkspaceId, WorkspaceMemberId } from "./primitives.js";

export const UsagePolicy = z.object({
  file_size_cap_bytes: z.number().int().positive(),
  file_count_cap: z.number().int().positive(),
  revision_size_cap_bytes: z.number().int().positive(),
  bundle_size_cap_bytes: z.number().int().positive(),
  actor_rate_limit_per_minute: z.number().int().positive(),
  workspace_burst_cap_per_minute: z.number().int().positive(),
  artifact_rate_limit_per_minute: z.number().int().positive(),
  content_gateway_token_ttl_seconds: z.number().int().positive(),
  upload_session_ttl_seconds: z.number().int().positive(),
  access_link_creation_enabled: z.boolean(),
  bundles_enabled: z.boolean(),
  auto_deletion_days: z.number().int().positive(),
  auto_deletion_platform_cap_days: z.number().int().positive(),
  pinned_artifact_cap: z.number().int().positive(),
  audit_retention_days: z.number().int().positive(),
  revision_retention_days: z.number().int().positive().nullable(),
});
export type UsagePolicy = z.infer<typeof UsagePolicy>;

export const WorkspaceSummary = z.object({
  id: WorkspaceId,
  name: z.string().min(1).max(120),
  created_at: IsoDateTime,
});
export type WorkspaceSummary = z.infer<typeof WorkspaceSummary>;

export const WhoamiResponse = z.object({
  actor: z.object({
    type: ActorType,
    id: z.string().min(1),
    display: z.string().min(1).max(200),
    audience: AuthAudience,
  }),
  workspace: WorkspaceSummary,
  workspace_member_id: WorkspaceMemberId.nullable(),
  scopes: z.array(Scope),
});
export type WhoamiResponse = z.infer<typeof WhoamiResponse>;

export const UpdateWorkspaceRequest = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  auto_deletion_days: z.number().int().min(1).max(90).optional(),
});
export type UpdateWorkspaceRequest = z.infer<typeof UpdateWorkspaceRequest>;

export const UpdateWorkspaceResponse = z.object({
  workspace: WorkspaceSummary,
  usage_policy: UsagePolicy,
  updated_at: IsoDateTime,
});
export type UpdateWorkspaceResponse = z.infer<typeof UpdateWorkspaceResponse>;
