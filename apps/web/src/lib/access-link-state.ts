import type { WebAccessLinkRow } from "@agent-paste/contracts";
import type { BadgeTone } from "../components/ui/Badge";

// `hydrated` gates the wall-clock expiry check: on the server and first client
// paint we never read Date.now(), so SSR and hydration agree. The Expired state
// settles in once the client has mounted. Mirrors keyState in KeysTable.
export function accessLinkState(row: WebAccessLinkRow, hydrated: boolean): { label: string; tone: BadgeTone } {
  if (row.revoked) {
    return { label: "Revoked", tone: "destructive" };
  }
  if (hydrated && row.expires_at && Date.parse(row.expires_at) <= Date.now()) {
    return { label: "Expired", tone: "warning" };
  }
  return { label: "Active", tone: "success" };
}
