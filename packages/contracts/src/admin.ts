import { z } from "zod";
import { AuditEvent } from "./audit.js";
import { PageInfo } from "./common.js";
import { PlatformLockdownScope } from "./enums.js";
import { ArtifactId, IsoDateTime, WorkspaceId } from "./primitives.js";

export const PlatformLockdownId = z.string().min(1).max(80).brand<"PlatformLockdownId">();
export type PlatformLockdownId = z.infer<typeof PlatformLockdownId>;

export const PlatformLockdownRequest = z.discriminatedUnion("scope", [
  z.object({
    scope: z.literal(PlatformLockdownScope.enum.workspace),
    workspace_id: WorkspaceId,
    reason_code: z.string().regex(/^[a-z0-9_]+$/),
  }),
  z.object({
    scope: z.literal(PlatformLockdownScope.enum.artifact),
    artifact_id: ArtifactId,
    reason_code: z.string().regex(/^[a-z0-9_]+$/),
  }),
]);
export type PlatformLockdownRequest = z.infer<typeof PlatformLockdownRequest>;

export const PlatformLockdownDetail = z.object({
  id: PlatformLockdownId,
  scope: PlatformLockdownScope,
  target_id: z.string().min(1),
  reason_code: z.string().regex(/^[a-z0-9_]+$/),
  set_at: IsoDateTime,
  set_by: z.string().min(1),
  lifted_at: IsoDateTime.nullable(),
  lifted_by: z.string().min(1).nullable(),
});
export type PlatformLockdownDetail = z.infer<typeof PlatformLockdownDetail>;

export const PlatformLockdownResponse = z.object({
  id: PlatformLockdownId.optional(),
  scope: PlatformLockdownScope,
  target_id: z.string().min(1),
  active: z.boolean(),
  changed_at: IsoDateTime,
});
export type PlatformLockdownResponse = z.infer<typeof PlatformLockdownResponse>;

export const PlatformLockdownListResponse = z.object({
  data: z.array(PlatformLockdownDetail),
  page_info: PageInfo,
});
export type PlatformLockdownListResponse = z.infer<typeof PlatformLockdownListResponse>;

export const LiftPlatformLockdownResponse = z.object({
  id: PlatformLockdownId,
  active: z.literal(false),
  lifted_at: IsoDateTime,
});
export type LiftPlatformLockdownResponse = z.infer<typeof LiftPlatformLockdownResponse>;

export const AdminSecretName = z.enum([
  "access_link_signing_key",
  "api_key_pepper",
  "artifact_bytes_encryption_key",
  "content_gateway_signing_key",
  "web_session_seal_key",
]);
export type AdminSecretName = z.infer<typeof AdminSecretName>;

export const SecretRotationResponse = z.object({
  secret_name: AdminSecretName,
  status: z.literal("accepted"),
  requested_at: IsoDateTime,
});
export type SecretRotationResponse = z.infer<typeof SecretRotationResponse>;

export const AdminRecentAuditResponse = z.object({
  data: z.array(AuditEvent),
  page_info: PageInfo,
});
export type AdminRecentAuditResponse = z.infer<typeof AdminRecentAuditResponse>;
