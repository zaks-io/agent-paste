import { formatChangeSummary } from "../audit/change-summary.js";
import { repositoryError } from "../repository-error.js";
import type { Artifact, OperationEvent, PlatformLockdown } from "../types.js";

// Unified cursor shape for both backends. The wire format is unchanged:
// btoa(JSON.stringify({ created_at, id })). Postgres compares the Date directly;
// the local store canonicalizes it back to an ISO string for comparison.
export type WebArtifactCursor = {
  createdAt: Date;
  id: string;
};

export type WebAuditCursor = {
  occurredAt: Date;
  id: string;
};

export type LockdownCursor = {
  setAt: Date;
  id: string;
};

export function toWebArtifactRow(artifact: Artifact) {
  return {
    id: artifact.id,
    title: artifact.title,
    status: webArtifactStatus(artifact),
    latest_revision_id: artifact.revision_id,
    pinned: artifact.pinned_at !== null,
    lockdown: artifact.access_link_lockdown_at !== null,
    last_published_at: artifact.created_at,
    auto_delete_at: artifact.status === "deleted" || artifact.pinned_at !== null ? null : artifact.expires_at,
  };
}

export function webArtifactStatus(artifact: Artifact): "Published" | "Deleted" | "Expired" {
  if (artifact.status === "deleted") {
    return "Deleted";
  }
  if (artifact.status === "expired") {
    return "Expired";
  }
  return "Published";
}

export function toWebAuditRow(event: OperationEvent) {
  return {
    id: event.id,
    time: event.occurred_at,
    actor: `${event.actor_type}:${event.actor_id ?? "unknown"}`,
    action: event.action,
    target: `${event.target_type}:${event.target_id}`,
    change_summary: formatChangeSummary(event.action, event.details),
    request_id: event.request_id ?? "",
  };
}

export function toWebOperatorEventRow(event: OperationEvent) {
  return {
    ...toWebAuditRow(event),
    workspace_id: event.workspace_id,
    actor_type: event.actor_type,
    target_type: event.target_type,
  };
}

export function encodeWebArtifactCursor(artifact: Artifact): string {
  return btoa(JSON.stringify({ created_at: artifact.created_at, id: artifact.id }))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

export function decodeWebArtifactCursor(cursor: string): WebArtifactCursor {
  try {
    const padded = cursor
      .replaceAll("-", "+")
      .replaceAll("_", "/")
      .padEnd(Math.ceil(cursor.length / 4) * 4, "=");
    const raw = JSON.parse(atob(padded)) as { created_at?: unknown; id?: unknown };
    if (typeof raw.created_at !== "string" || typeof raw.id !== "string") {
      repositoryError("invalid_cursor");
    }
    const createdAt = new Date(raw.created_at);
    if (Number.isNaN(createdAt.getTime())) {
      repositoryError("invalid_cursor");
    }
    return { createdAt, id: raw.id };
  } catch {
    repositoryError("invalid_cursor");
  }
}

export function normalizeWebArtifactLimit(limit: number | undefined): number {
  const resolved = limit ?? 50;
  if (!Number.isInteger(resolved) || resolved < 1 || resolved > 100) {
    repositoryError("invalid_pagination_limit");
  }
  return resolved;
}

export function encodeWebAuditCursor(event: OperationEvent): string {
  return btoa(JSON.stringify({ occurred_at: event.occurred_at, id: event.id }))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

export function decodeWebAuditCursor(cursor: string): WebAuditCursor {
  try {
    const padded = cursor
      .replaceAll("-", "+")
      .replaceAll("_", "/")
      .padEnd(Math.ceil(cursor.length / 4) * 4, "=");
    const raw = JSON.parse(atob(padded)) as { occurred_at?: unknown; id?: unknown };
    if (typeof raw.occurred_at !== "string" || typeof raw.id !== "string") {
      repositoryError("invalid_cursor");
    }
    const occurredAt = new Date(raw.occurred_at);
    if (Number.isNaN(occurredAt.getTime())) {
      repositoryError("invalid_cursor");
    }
    return { occurredAt, id: raw.id };
  } catch {
    repositoryError("invalid_cursor");
  }
}

export function normalizeWebAuditLimit(limit: number | undefined): number {
  const resolved = limit ?? 50;
  if (!Number.isInteger(resolved) || resolved < 1 || resolved > 100) {
    repositoryError("invalid_pagination_limit");
  }
  return resolved;
}

export function encodeLockdownCursor(lockdown: PlatformLockdown): string {
  return btoa(JSON.stringify({ set_at: lockdown.set_at, id: lockdown.id }))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

export function decodeLockdownCursor(cursor: string): LockdownCursor {
  try {
    const padded = cursor
      .replaceAll("-", "+")
      .replaceAll("_", "/")
      .padEnd(Math.ceil(cursor.length / 4) * 4, "=");
    const raw = JSON.parse(atob(padded)) as { set_at?: unknown; id?: unknown };
    if (typeof raw.set_at !== "string" || typeof raw.id !== "string") {
      repositoryError("invalid_cursor");
    }
    const setAt = new Date(raw.set_at);
    if (Number.isNaN(setAt.getTime()) || setAt.toISOString() !== raw.set_at) {
      repositoryError("invalid_cursor");
    }
    return { setAt, id: raw.id };
  } catch {
    repositoryError("invalid_cursor");
  }
}

export function normalizeLockdownLimit(limit: number | undefined): number {
  const resolved = limit ?? 50;
  if (!Number.isInteger(resolved) || resolved < 1 || resolved > 100) {
    repositoryError("invalid_pagination_limit");
  }
  return resolved;
}
