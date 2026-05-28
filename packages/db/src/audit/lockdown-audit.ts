import type { Entities } from "../repository/ports.js";

/** Resolve the tenant workspace for a platform lockdown audit event (ADR 0040). */
export async function resolveLockdownAuditWorkspaceId(
  entities: Entities,
  scope: "workspace" | "artifact",
  targetId: string,
): Promise<string | null> {
  if (scope === "workspace") {
    const workspace = await entities.workspaces.findById(targetId);
    return workspace?.id ?? null;
  }
  const artifact = await entities.artifacts.findById(targetId);
  return artifact?.workspace_id ?? null;
}
