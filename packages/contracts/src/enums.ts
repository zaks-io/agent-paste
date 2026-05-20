import { z } from "zod";

export const Scope = z.enum(["write", "read", "share", "manage_keys", "manage_workspace", "read_audit"]);
export type Scope = z.infer<typeof Scope>;

export const MemberOnlyScope = z.enum(["manage_keys", "manage_workspace", "read_audit"]);
export type MemberOnlyScope = z.infer<typeof MemberOnlyScope>;

export const AgentScope = z.enum(["write", "read", "share"]);
export type AgentScope = z.infer<typeof AgentScope>;

export const RenderMode = z.enum(["html", "markdown", "text", "image", "audio", "video", "directory"]);
export type RenderMode = z.infer<typeof RenderMode>;

export const McpPublishRenderMode = z.enum(["html", "markdown", "text"]);
export type McpPublishRenderMode = z.infer<typeof McpPublishRenderMode>;

export const ActorType = z.enum(["member", "api_key", "system", "platform"]);
export type ActorType = z.infer<typeof ActorType>;

export const AuthAudience = z.enum(["dashboard", "cli", "mcp", "api_key", "system", "platform"]);
export type AuthAudience = z.infer<typeof AuthAudience>;

export const ArtifactStatus = z.enum(["unpublished", "active", "deleted"]);
export type ArtifactStatus = z.infer<typeof ArtifactStatus>;

export const RevisionStatus = z.enum(["draft", "published", "retained"]);
export type RevisionStatus = z.infer<typeof RevisionStatus>;

export const UploadSessionStatus = z.enum(["pending", "finalized", "abandoned", "expired", "failed_terminal"]);
export type UploadSessionStatus = z.infer<typeof UploadSessionStatus>;

export const AccessLinkType = z.enum(["share", "revision"]);
export type AccessLinkType = z.infer<typeof AccessLinkType>;

export const BundleStatus = z.enum(["disabled", "pending", "ready", "failed"]);
export type BundleStatus = z.infer<typeof BundleStatus>;

export const SafetyWarningSeverity = z.enum(["info", "warning"]);
export type SafetyWarningSeverity = z.infer<typeof SafetyWarningSeverity>;

export const SafetyWarningScope = z.enum(["artifact", "revision", "file"]);
export type SafetyWarningScope = z.infer<typeof SafetyWarningScope>;

export const PlatformLockdownScope = z.enum(["workspace", "artifact"]);
export type PlatformLockdownScope = z.infer<typeof PlatformLockdownScope>;

export const DeletionReason = z.enum(["user", "auto_deletion", "operator", "upload_cleanup"]);
export type DeletionReason = z.infer<typeof DeletionReason>;
