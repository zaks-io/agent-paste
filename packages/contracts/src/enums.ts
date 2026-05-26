import { z } from "./zod.js";

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
  "api_key.created",
  "api_key.revoked",
  "upload_session.created",
  "upload_session.finalized",
  "upload_session.expired",
  "upload_session.failed",
  "artifact.created",
  "artifact.published",
  "artifact.deleted",
  "artifact.expired",
  "revision.draft_created",
  "platform.lockdown.set",
  "platform.lockdown.lifted",
  "cleanup.run",
  "admin.destructive_operation",
]);
export type OperationEventAction = z.infer<typeof OperationEventAction>;

export const OperationEventTargetType = z.enum(["workspace", "api_key", "upload_session", "artifact", "cleanup"]);
export type OperationEventTargetType = z.infer<typeof OperationEventTargetType>;
