import { z } from "zod";
import { ApiKeySummary, CreateApiKeyResponse } from "./apiKeys.js";
import { ArtifactDetail, ArtifactListResponse, DeleteArtifactResponse } from "./artifacts.js";
import { PageInfo } from "./common.js";
import { ActorType, OperationEventAction, OperationEventTargetType } from "./enums.js";
import { IsoDateTime, OperationEventId, WorkspaceId } from "./primitives.js";
import { WorkspaceSummary } from "./workspace.js";

export const CreateWorkspaceRequest = z.object({
  email: z.string().email(),
  name: z.string().trim().min(1).max(120).optional(),
});
export type CreateWorkspaceRequest = z.infer<typeof CreateWorkspaceRequest>;

export const WorkspaceDetail = WorkspaceSummary.extend({
  contact_email: z.string().email().nullable(),
});
export type WorkspaceDetail = z.infer<typeof WorkspaceDetail>;

export const WorkspaceListResponse = z.object({
  data: z.array(WorkspaceDetail),
  page_info: PageInfo,
});
export type WorkspaceListResponse = z.infer<typeof WorkspaceListResponse>;

export const RevokeApiKeyResponse = z.object({
  api_key: ApiKeySummary,
  revoked_at: IsoDateTime,
});
export type RevokeApiKeyResponse = z.infer<typeof RevokeApiKeyResponse>;

export const CleanupRunRequest = z.object({
  dry_run: z.boolean().default(false),
});
export type CleanupRunRequest = z.infer<typeof CleanupRunRequest>;

export const CleanupRunResponse = z.object({
  dry_run: z.boolean(),
  expired_artifacts: z.number().int().nonnegative(),
  expired_upload_sessions: z.number().int().nonnegative(),
  deleted_r2_objects: z.number().int().nonnegative(),
  occurred_at: IsoDateTime,
});
export type CleanupRunResponse = z.infer<typeof CleanupRunResponse>;

export const OperationEvent = z.object({
  id: OperationEventId,
  workspace_id: WorkspaceId.nullable(),
  actor_type: ActorType,
  actor_id: z.string().nullable(),
  action: OperationEventAction,
  target_type: OperationEventTargetType,
  target_id: z.string().min(1),
  details: z.record(z.string(), z.unknown()),
  request_id: z.string().nullable(),
  occurred_at: IsoDateTime,
});
export type OperationEvent = z.infer<typeof OperationEvent>;

export const OperationEventListResponse = z.object({
  data: z.array(OperationEvent),
  page_info: PageInfo,
});
export type OperationEventListResponse = z.infer<typeof OperationEventListResponse>;

export { ArtifactDetail, ArtifactListResponse, CreateApiKeyResponse, DeleteArtifactResponse };
