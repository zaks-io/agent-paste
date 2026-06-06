import { z } from "./zod.js";

// In-workspace authorization: what a member may do to artifacts in their own
// workspace. Distinct from a WorkOS "role" (platform identity — operator or not,
// read off the token's role claim) and from WorkOS "permissions" (their RBAC,
// which we deliberately do not use). Every member is provisioned the full set
// today because a workspace has one member; the column is the seam for if/when
// multi-member workspaces are demanded. The clearer `workspace:*` naming and any
// role->scope layer are deferred until that demand is real. See ADR 0082.
export const Scope = z.enum(["publish", "read", "admin"]);
export type Scope = z.infer<typeof Scope>;

export const ActorType = z.enum(["api_key", "member", "admin", "system", "platform"]);
export type ActorType = z.infer<typeof ActorType>;

export const ArtifactStatus = z.enum(["active", "deleted", "expired"]);
export type ArtifactStatus = z.infer<typeof ArtifactStatus>;

export const UploadSessionStatus = z.enum(["pending", "finalized", "expired", "failed"]);
export type UploadSessionStatus = z.infer<typeof UploadSessionStatus>;

export const OperationEventAction = z.enum([
  "workspace.created",
  "workspace.settings.updated",
  "workspace.plan.updated",
  "api_key.created",
  "api_key.revoked",
  "upload_session.created",
  "artifact.created",
  "artifact.published",
  "artifact.deleted",
  "artifact.expired",
  "artifact.pinned",
  "artifact.unpinned",
  "revision.draft_created",
  "revision.retained",
  "safety_warnings.replaced",
  "access_link.lockdown.set",
  "access_link.lockdown.lifted",
  "ephemeral.workspace.provisioned",
  "ephemeral.workspace.claimed",
  "platform.lockdown.set",
  "platform.lockdown.lifted",
  "cleanup.run",
]);
export type OperationEventAction = z.infer<typeof OperationEventAction>;

export const OperationEventTargetType = z.enum([
  "workspace",
  "api_key",
  "upload_session",
  "artifact",
  "revision",
  "cleanup",
]);
export type OperationEventTargetType = z.infer<typeof OperationEventTargetType>;
