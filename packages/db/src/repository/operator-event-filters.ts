export const OPERATOR_SECURITY_EVENT_ACTIONS = [
  "platform.lockdown.set",
  "platform.lockdown.lifted",
  "api_key.revoked",
  "admin.destructive_operation",
  "artifact.deleted",
] as const;

export const OPERATOR_LIFECYCLE_EVENT_ACTIONS = [
  "workspace.created",
  "workspace.settings.updated",
  "api_key.created",
  "upload_session.created",
  "upload_session.finalized",
  "upload_session.expired",
  "upload_session.failed",
  "artifact.created",
  "artifact.published",
  "artifact.pinned",
  "artifact.unpinned",
  "artifact.expired",
  "revision.draft_created",
  "cleanup.run",
] as const;

export type OperatorEventFocus = "all" | "security" | "lifecycle";

export type OperatorEventFilters = {
  workspaceId?: string;
  actorType?: string;
  action?: string;
  targetType?: string;
  requestId?: string;
  focus?: OperatorEventFocus;
};

export function resolveOperatorEventActions(filters: OperatorEventFilters): string[] | undefined {
  if (filters.action) {
    return [filters.action];
  }
  if (!filters.focus || filters.focus === "all") {
    return undefined;
  }
  return filters.focus === "security"
    ? [...OPERATOR_SECURITY_EVENT_ACTIONS]
    : [...OPERATOR_LIFECYCLE_EVENT_ACTIONS];
}
