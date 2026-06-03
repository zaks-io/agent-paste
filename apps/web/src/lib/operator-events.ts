import type { WebOperatorEventFocus } from "@agent-paste/contracts";

export type OperatorEventSearch = {
  focus?: WebOperatorEventFocus;
  workspace_id?: string;
  actor_type?: string;
  action?: string;
  target_type?: string;
  request_id?: string;
};

export function parseOperatorEventSearch(search: Record<string, unknown>): OperatorEventSearch {
  const next: OperatorEventSearch = {};
  const focus = search.focus;
  if (focus === "security" || focus === "lifecycle" || focus === "all") {
    if (focus !== "all") {
      next.focus = focus;
    }
  }
  for (const key of ["workspace_id", "actor_type", "action", "target_type", "request_id"] as const) {
    const value = search[key];
    if (typeof value === "string" && value.trim().length > 0) {
      next[key] = value.trim();
    }
  }
  return next;
}

export function operatorEventsQueryString(search: OperatorEventSearch): string {
  const params = new URLSearchParams();
  if (search.focus) {
    params.set("focus", search.focus);
  }
  if (search.workspace_id) {
    params.set("workspace_id", search.workspace_id);
  }
  if (search.actor_type) {
    params.set("actor_type", search.actor_type);
  }
  if (search.action) {
    params.set("action", search.action);
  }
  if (search.target_type) {
    params.set("target_type", search.target_type);
  }
  if (search.request_id) {
    params.set("request_id", search.request_id);
  }
  const query = params.toString();
  return query.length > 0 ? `?${query}` : "";
}
