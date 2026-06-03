import type { LockdownScope } from "@agent-paste/contracts";

export type LockdownTriagePrefill = {
  scope?: LockdownScope;
  target_id?: string;
  reason_code?: string;
};

export function parseLockdownTriageSearch(search: Record<string, unknown>): LockdownTriagePrefill {
  const next: LockdownTriagePrefill = {};
  const scope = search.triage_scope;
  if (scope === "workspace" || scope === "artifact") {
    next.scope = scope;
  }
  for (const key of ["triage_target", "triage_reason"] as const) {
    const value = search[key];
    if (typeof value === "string" && value.trim().length > 0) {
      if (key === "triage_target") {
        next.target_id = value.trim();
      } else {
        next.reason_code = value.trim();
      }
    }
  }
  return next;
}

export function lockdownTriageFromEvent(input: {
  target_type: string;
  target: string;
  change_summary: string;
}): LockdownTriagePrefill | null {
  if (input.target_type !== "workspace" && input.target_type !== "artifact") {
    return null;
  }
  const targetId = input.target.split(":")[1]?.trim();
  if (!targetId) {
    return null;
  }
  const reasonMatch = /reason:\s*([^\s),]+)/.exec(input.change_summary);
  return {
    scope: input.target_type,
    target_id: targetId,
    ...(reasonMatch ? { reason_code: reasonMatch[1] } : {}),
  };
}

export function lockdownTriageQueryString(prefill: LockdownTriagePrefill): Record<string, string> {
  const search: Record<string, string> = {};
  if (prefill.scope) {
    search.triage_scope = prefill.scope;
  }
  if (prefill.target_id) {
    search.triage_target = prefill.target_id;
  }
  if (prefill.reason_code) {
    search.triage_reason = prefill.reason_code;
  }
  return search;
}
