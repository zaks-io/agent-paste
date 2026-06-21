export const OPERATOR_SECURITY_EVENT_ACTIONS = [
  "platform.lockdown.set",
  "platform.lockdown.lifted",
  "access_link.lockdown.set",
  "access_link.lockdown.lifted",
  "api_key.revoked",
  "agent_auth.access_token.revoked",
  "agent_auth.delegation.revoked",
  "artifact.deleted",
  "workspace.plan.updated",
] as const;

export const OPERATOR_LIFECYCLE_EVENT_ACTIONS = [
  "workspace.created",
  "workspace.settings.updated",
  "api_key.created",
  "agent_auth.access_token.issued",
  "agent_auth.anonymous_claim.completed",
  "agent_auth.anonymous_claim.started",
  "agent_auth.claim.completed",
  "agent_auth.delegation.created",
  "agent_auth.registration.created",
  "upload_session.created",
  "artifact.created",
  "artifact.published",
  "artifact.pinned",
  "artifact.unpinned",
  "artifact.expired",
  "revision.draft_created",
  "revision.retained",
  "safety_warnings.replaced",
  "ephemeral.workspace.provisioned",
  "ephemeral.workspace.claimed",
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

export function allOperatorClassifiedEventActions(): readonly string[] {
  return [...OPERATOR_SECURITY_EVENT_ACTIONS, ...OPERATOR_LIFECYCLE_EVENT_ACTIONS];
}

export function resolveOperatorEventActions(filters: OperatorEventFilters): string[] | undefined {
  if (filters.action) {
    return [filters.action];
  }
  if (!filters.focus || filters.focus === "all") {
    return undefined;
  }
  return filters.focus === "security" ? [...OPERATOR_SECURITY_EVENT_ACTIONS] : [...OPERATOR_LIFECYCLE_EVENT_ACTIONS];
}
