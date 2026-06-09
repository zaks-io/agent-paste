import type { BadgeTone } from "@agent-paste/ui";

export type EntityState = { label: string; tone: BadgeTone };

type RevocableRow = { revoked: boolean; expires_at?: string | null };

// `hydrated` gates the wall-clock expiry check: on the server and first client
// paint we never read Date.now(), so SSR and hydration agree. The Expired state
// settles in once the client has mounted.
export function revocableEntityState(row: RevocableRow, hydrated: boolean): EntityState {
  if (row.revoked) {
    return { label: "Revoked", tone: "destructive" };
  }
  if (hydrated && row.expires_at && Date.parse(row.expires_at) <= Date.now()) {
    return { label: "Expired", tone: "warning" };
  }
  return { label: "Active", tone: "success" };
}
