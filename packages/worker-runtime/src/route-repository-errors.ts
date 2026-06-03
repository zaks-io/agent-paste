import { routeContracts, type RouteId } from "@agent-paste/contracts";
import type { RepositoryErrorCode } from "@agent-paste/db";
import { RepositoryError, repositoryErrorToAppError } from "@agent-paste/db";

/**
 * Repository failure kinds each route handler can surface via {@link repositoryErrorToAppError}.
 * Kept alongside route contracts so CI can assert per-route `contract.errors` coverage (AP-131).
 */
export const routeRepositorySurfaces = {
  "whoami.get": [],
  "mcp.whoami": [],
  "usagePolicy.get": [],
  "apiKeys.revokeCurrent": ["current_api_key_not_found"],
  "agentView.public": [],
  "accessLinks.resolve": [],
  "ephemeral.provision": [],
  "ephemeral.claim": ["forbidden", "not_found"],
  "artifacts.list": ["invalid_cursor", "invalid_pagination_limit"],
  "artifacts.delete": ["artifact_not_found"],
  "artifacts.updateDisplayMetadata": ["artifact_not_found"],
  "accessLinks.create": [
    "access_link_revision_requires_revision_id",
    "access_link_share_cannot_pin_revision",
    "artifact_not_found",
    "not_found",
  ],
  "accessLinks.mint": [
    "access_link_inactive_artifact_missing",
    "access_link_inactive_expired",
    "access_link_inactive_revoked",
    "access_link_lockdown_active",
    "not_found",
  ],
  "accessLinks.list": [],
  "accessLinks.revoke": ["not_found"],
  "agentView.getLatest": [],
  "agentView.getRevision": [],
  "revisions.list": [],
  "revisions.publish": [
    "artifact_not_found",
    "draft_revision_conflict",
    "entrypoint_not_in_revision",
    "revision_ceiling_exceeded",
    "revision_retained",
    "revision_unpublished",
  ],
  "web.auth.callback": [],
  "web.workspace.get": [],
  "web.artifacts.list": ["invalid_cursor", "invalid_pagination_limit"],
  "web.artifacts.get": [],
  "web.artifacts.pin": ["artifact_not_found", "pinned_artifact_cap_exceeded"],
  "web.artifacts.unpin": ["artifact_not_found"],
  "web.apiKeys.list": [],
  "web.apiKeys.create": [],
  "web.apiKeys.revoke": ["api_key_not_found"],
  "web.audit.list": ["invalid_cursor", "invalid_pagination_limit"],
  "web.settings.get": [],
  "web.settings.update": ["invalid_auto_deletion_days"],
  "web.admin.lockdown.set": [],
  "web.admin.lockdown.list": ["invalid_cursor", "invalid_pagination_limit"],
  "web.admin.lockdown.lift": ["not_found"],
  "web.admin.events.list": ["invalid_cursor", "invalid_pagination_limit"],
  "uploadSessions.create": [
    "artifact_not_found",
    "draft_revision_conflict",
    "file_count_cap_exceeded",
    "file_size_cap_exceeded",
    "invalid_ttl_seconds",
    "revision_size_cap_exceeded",
  ],
  "uploadSessions.putFile": [],
  "uploadSessions.finalize": ["draft_revision_conflict", "upload_incomplete", "upload_session_not_found"],
  "content.get": [],
  "content.head": [],
  "content.bundle": [],
  "content.bundleHead": [],
} as const satisfies Record<RouteId, readonly RepositoryErrorCode[]>;

export function collectRouteRepositoryDeclarationFailures(
  surfaces: Record<string, readonly RepositoryErrorCode[]> = routeRepositorySurfaces,
): string[] {
  const failures: string[] = [];
  for (const contract of routeContracts) {
    const kinds = surfaces[contract.id] ?? [];
    const declared = new Set<string>(contract.errors);
    for (const kind of kinds) {
      const appCode = repositoryErrorToAppError(new RepositoryError(kind));
      if (appCode && !declared.has(appCode)) {
        failures.push(
          `Route ${contract.id} can surface ${kind} -> ${appCode} but contract.errors omits ${appCode}`,
        );
      }
    }
  }
  return failures;
}

export function assertRouteRepositoryErrorsDeclared(
  surfaces: Record<string, readonly RepositoryErrorCode[]> = routeRepositorySurfaces,
): void {
  const failures = collectRouteRepositoryDeclarationFailures(surfaces);
  if (failures.length > 0) {
    throw new Error(failures.join("\n"));
  }
}
