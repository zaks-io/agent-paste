/**
 * Tenant-safe Change Summary formatting for operation_events (Audit Events).
 * See ADR 0004 and CONTEXT.md (change-summary).
 */

const SENSITIVE_DETAIL_KEYS = new Set([
  "secret",
  "api_key_secret",
  "token",
  "access_token",
  "refresh_token",
  "password",
  "blob",
  "signed_url",
  "fragment",
  "authorization",
  "cookie",
]);

export type AuditEventCategory = "security" | "lifecycle";

const SECURITY_ACTIONS = new Set([
  "platform.lockdown.set",
  "platform.lockdown.lifted",
  "api_key.revoked",
  "admin.destructive_operation",
  "artifact.deleted",
]);

export function classifyAuditAction(action: string): AuditEventCategory {
  return SECURITY_ACTIONS.has(action) ? "security" : "lifecycle";
}

export function isSecurityRelevantAction(action: string): boolean {
  return classifyAuditAction(action) === "security";
}

/** Strip sensitive keys before persisting or summarizing untrusted detail payloads. */
export function redactAuditDetails(details: Record<string, unknown>): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) {
    if (SENSITIVE_DETAIL_KEYS.has(key.toLowerCase())) {
      continue;
    }
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      redacted[key] = redactAuditDetails(value as Record<string, unknown>);
      continue;
    }
    redacted[key] = value;
  }
  return redacted;
}

function readString(details: Record<string, unknown>, key: string): string | undefined {
  const value = details[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readNumber(details: Record<string, unknown>, key: string): number | undefined {
  const value = details[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function lockdownScopeLabel(scope: string | undefined): string {
  return scope === "workspace" ? "workspace" : scope === "artifact" ? "artifact" : "target";
}

/** Format a tenant-safe Change Summary for dashboard and operator surfaces. */
export function formatChangeSummary(action: string, details: Record<string, unknown>): string {
  const safe = redactAuditDetails(details);

  switch (action) {
    case "platform.lockdown.set": {
      const scope = lockdownScopeLabel(readString(safe, "scope"));
      const reason = readString(safe, "reason_code");
      return reason ? `Platform lockdown set on ${scope} (reason: ${reason})` : `Platform lockdown set on ${scope}`;
    }
    case "platform.lockdown.lifted": {
      const scope = lockdownScopeLabel(readString(safe, "scope"));
      const reason = readString(safe, "reason_code");
      return reason ? `Platform lockdown lifted on ${scope} (was: ${reason})` : `Platform lockdown lifted on ${scope}`;
    }
    case "api_key.created": {
      const name = readString(safe, "name");
      return name ? `API key created (${name})` : "API key created";
    }
    case "api_key.revoked":
      return "API key revoked";
    case "workspace.created":
      return "Workspace created";
    case "workspace.settings.updated": {
      const days = readNumber(safe, "auto_deletion_days");
      return days === undefined
        ? "Workspace settings updated"
        : `Workspace settings updated (${days}-day auto-deletion)`;
    }
    case "artifact.created":
      return "Artifact created";
    case "artifact.published": {
      const revisionNumber = readNumber(safe, "revision_number");
      const fileCount = readNumber(safe, "file_count");
      if (revisionNumber !== undefined && fileCount !== undefined) {
        return `Published revision ${revisionNumber} (${fileCount} file${fileCount === 1 ? "" : "s"})`;
      }
      if (revisionNumber !== undefined) {
        return `Published revision ${revisionNumber}`;
      }
      return "Artifact published";
    }
    case "artifact.deleted":
      return "Artifact deleted";
    case "artifact.pinned":
      return "Artifact pinned";
    case "artifact.unpinned":
      return "Artifact unpinned";
    case "revision.draft_created":
      return "Draft revision created";
    case "upload_session.created":
      return "Upload session created";
    case "upload_session.finalized":
      return "Upload session finalized";
    case "upload_session.expired":
      return "Upload session expired";
    case "upload_session.failed":
      return "Upload session failed";
    case "cleanup.run": {
      const artifacts = readNumber(safe, "expired_artifacts");
      const sessions = readNumber(safe, "expired_upload_sessions");
      if (artifacts !== undefined || sessions !== undefined) {
        return `Cleanup ran (${artifacts ?? 0} artifacts, ${sessions ?? 0} sessions)`;
      }
      return "Cleanup ran";
    }
    default:
      return summarizeFallbackDetails(safe);
  }
}

function summarizeFallbackDetails(details: Record<string, unknown>): string {
  const keys = Object.keys(details);
  if (keys.length === 0) {
    return "";
  }
  return keys
    .sort()
    .map((key) => `${key}=${String(details[key])}`)
    .join(", ");
}
