import type { WebAccessLinkRow } from "@agent-paste/contracts";
import { revocableEntityState, type EntityState } from "./revocable-entity-state";

export function accessLinkState(row: WebAccessLinkRow, hydrated: boolean): EntityState {
  return revocableEntityState(row, hydrated);
}
