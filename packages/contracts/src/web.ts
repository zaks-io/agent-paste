import { resolveUsagePolicy } from "@agent-paste/config";
import { ApiKeySummary, CreateApiKeyResponse } from "./apiKeys.js";
import { PageInfo } from "./common.js";
import { ActorType, OperationEventTargetType, Scope } from "./enums.js";
import { LiveUpdatePointer } from "./liveUpdates.js";
import { ArtifactId, IsoDateTime, OperationEventId, RevisionId, WorkspaceId } from "./primitives.js";
import { RenderMode } from "./revisions.js";
import { mvpUsagePolicy, UsagePolicy, WorkspaceSummary } from "./workspace.js";
import { z } from "./zod.js";

const SECONDS_PER_DAY = 24 * 60 * 60;
const PLATFORM_USAGE_POLICY = resolveUsagePolicy({ billingEnabled: false });
const MIN_AUTO_DELETION_DAYS = Math.floor(PLATFORM_USAGE_POLICY.min_ttl_seconds / SECONDS_PER_DAY);
const MAX_AUTO_DELETION_DAYS = Math.floor(PLATFORM_USAGE_POLICY.max_ttl_seconds / SECONDS_PER_DAY);

export const WorkspaceMemberId = z
  .string()
  .regex(/^mem_[0-9A-HJKMNP-TV-Z]{26}$/)
  .brand<"WorkspaceMemberId">();
export type WorkspaceMemberId = z.infer<typeof WorkspaceMemberId>;

export const WorkspaceMemberSummary = z.object({
  id: WorkspaceMemberId,
  workspace_id: WorkspaceId,
  email: z.string().email(),
  scopes: z.array(Scope).min(1),
  created_at: IsoDateTime,
  last_seen_at: IsoDateTime,
});
export type WorkspaceMemberSummary = z.infer<typeof WorkspaceMemberSummary>;

export const WebAuthCallbackResponse = z.object({
  workspace: WorkspaceSummary,
  workspace_member: WorkspaceMemberSummary,
  scopes: z.array(Scope).min(1),
  default_api_key: CreateApiKeyResponse.nullable(),
});
export type WebAuthCallbackResponse = z.infer<typeof WebAuthCallbackResponse>;

export const WebWorkspaceResponse = z.object({
  workspace: WorkspaceSummary,
  workspace_member: WorkspaceMemberSummary,
  usage_policy: UsagePolicy,
  default_key_first_run: z.boolean(),
});
export type WebWorkspaceResponse = z.infer<typeof WebWorkspaceResponse>;

export const WebArtifactStatus = z.enum(["Published", "Deleted", "Expired"]);
export type WebArtifactStatus = z.infer<typeof WebArtifactStatus>;

export const WebArtifactRow = z.object({
  id: ArtifactId,
  title: z.string().min(1),
  status: WebArtifactStatus,
  latest_revision_id: RevisionId.nullable(),
  pinned: z.boolean(),
  lockdown: z.boolean(),
  last_published_at: IsoDateTime.nullable(),
  auto_delete_at: IsoDateTime.nullable(),
});
export type WebArtifactRow = z.infer<typeof WebArtifactRow>;

export const WebArtifactListResponse = z.object({
  items: z.array(WebArtifactRow),
  page_info: PageInfo,
});
export type WebArtifactListResponse = z.infer<typeof WebArtifactListResponse>;

export const WebArtifactViewer = z.object({
  iframe_src: LiveUpdatePointer.shape.iframe_src,
  render_mode: RenderMode,
});
export type WebArtifactViewer = z.infer<typeof WebArtifactViewer>;

export const WebArtifactDetailResponse = WebArtifactRow.extend({
  entrypoint: z.string().min(1),
  file_count: z.number().int().nonnegative(),
  size_bytes: z.number().int().nonnegative(),
  viewer: WebArtifactViewer.nullable(),
});
export type WebArtifactDetailResponse = z.infer<typeof WebArtifactDetailResponse>;

export const WebApiKeyRow = ApiKeySummary.extend({
  revoked: z.boolean(),
});
export type WebApiKeyRow = z.infer<typeof WebApiKeyRow>;

export const WebApiKeyListResponse = z.object({
  items: z.array(WebApiKeyRow),
  page_info: PageInfo,
});
export type WebApiKeyListResponse = z.infer<typeof WebApiKeyListResponse>;

export const WebAuditRow = z.object({
  id: OperationEventId,
  time: IsoDateTime,
  actor: z.string(),
  action: z.string(),
  target: z.string(),
  change_summary: z.string(),
  request_id: z.string(),
});
export type WebAuditRow = z.infer<typeof WebAuditRow>;

export const WebAuditListResponse = z.object({
  items: z.array(WebAuditRow),
  page_info: PageInfo,
});
export type WebAuditListResponse = z.infer<typeof WebAuditListResponse>;

export const WebOperatorEventFocus = z.enum(["all", "security", "lifecycle"]);
export type WebOperatorEventFocus = z.infer<typeof WebOperatorEventFocus>;

export const WebOperatorEventRow = WebAuditRow.extend({
  workspace_id: WorkspaceId.nullable(),
  actor_type: ActorType,
  target_type: OperationEventTargetType,
});
export type WebOperatorEventRow = z.infer<typeof WebOperatorEventRow>;

export const WebOperatorEventListResponse = z.object({
  items: z.array(WebOperatorEventRow),
  page_info: PageInfo,
});
export type WebOperatorEventListResponse = z.infer<typeof WebOperatorEventListResponse>;

export const WebSettingsResponse = z.object({
  workspace_name: z.string().min(1),
  auto_deletion_days: z.number().int().positive(),
  usage_policy: z.object({
    artifacts_per_day: z.number().int().nonnegative(),
    bytes_per_day: z.number().int().nonnegative(),
  }),
});
export type WebSettingsResponse = z.infer<typeof WebSettingsResponse>;

export const UpdateWebSettingsRequest = z.object({
  workspace_name: z.string().min(1).max(120),
  auto_deletion_days: z.number().int().min(MIN_AUTO_DELETION_DAYS).max(MAX_AUTO_DELETION_DAYS),
});
export type UpdateWebSettingsRequest = z.infer<typeof UpdateWebSettingsRequest>;
