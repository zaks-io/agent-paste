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
  "access_link.lockdown.set",
  "access_link.lockdown.lifted",
  "api_key.revoked",
  "artifact.deleted",
  "workspace.plan.updated",
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

type ChangeSummaryFormatter = (safe: Record<string, unknown>) => string;

function formatLockdownSet(safe: Record<string, unknown>): string {
  const scope = lockdownScopeLabel(readString(safe, "scope"));
  const reason = readString(safe, "reason_code");
  return reason ? `Platform lockdown set on ${scope} (reason: ${reason})` : `Platform lockdown set on ${scope}`;
}

function formatLockdownLifted(safe: Record<string, unknown>): string {
  const scope = lockdownScopeLabel(readString(safe, "scope"));
  const reason = readString(safe, "reason_code");
  return reason ? `Platform lockdown lifted on ${scope} (was: ${reason})` : `Platform lockdown lifted on ${scope}`;
}

function formatApiKeyCreated(safe: Record<string, unknown>): string {
  const name = readString(safe, "name");
  return name ? `API key created (${name})` : "API key created";
}

function formatWorkspaceSettingsUpdated(safe: Record<string, unknown>): string {
  const days = readNumber(safe, "auto_deletion_days");
  return days === undefined ? "Workspace settings updated" : `Workspace settings updated (${days}-day auto-deletion)`;
}

function formatArtifactPublished(safe: Record<string, unknown>): string {
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

function formatCleanupRun(safe: Record<string, unknown>): string {
  const artifacts = readNumber(safe, "expired_artifacts");
  const sessions = readNumber(safe, "expired_upload_sessions");
  if (artifacts !== undefined || sessions !== undefined) {
    return `Cleanup ran (${artifacts ?? 0} artifacts, ${sessions ?? 0} sessions)`;
  }
  return "Cleanup ran";
}

const constant =
  (text: string): ChangeSummaryFormatter =>
  () =>
    text;

const CHANGE_SUMMARY_FORMATTERS: Record<string, ChangeSummaryFormatter> = {
  "platform.lockdown.set": formatLockdownSet,
  "platform.lockdown.lifted": formatLockdownLifted,
  "api_key.created": formatApiKeyCreated,
  "api_key.revoked": constant("API key revoked"),
  "workspace.created": constant("Workspace created"),
  "workspace.settings.updated": formatWorkspaceSettingsUpdated,
  "artifact.created": constant("Artifact created"),
  "artifact.published": formatArtifactPublished,
  "artifact.deleted": constant("Artifact deleted"),
  "artifact.pinned": constant("Artifact pinned"),
  "artifact.unpinned": constant("Artifact unpinned"),
  "revision.draft_created": constant("Draft revision created"),
  "upload_session.created": constant("Upload session created"),
  "upload_session.finalized": constant("Upload session finalized"),
  "upload_session.expired": constant("Upload session expired"),
  "upload_session.failed": constant("Upload session failed"),
  "cleanup.run": formatCleanupRun,
};

/** Format a tenant-safe Change Summary for dashboard and operator surfaces. */
export function formatChangeSummary(action: string, details: Record<string, unknown>): string {
  const safe = redactAuditDetails(details);
  const formatter = CHANGE_SUMMARY_FORMATTERS[action];
  return formatter ? formatter(safe) : summarizeFallbackDetails(safe);
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
