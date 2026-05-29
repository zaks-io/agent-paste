import { routeContracts } from "@agent-paste/contracts";
import type { GuardState } from "@agent-paste/worker-runtime";

export type RouteParams = Record<string, string>;
export type RouteId = (typeof routeContracts)[number]["id"];
export type ContractById<Id extends RouteId> = Extract<(typeof routeContracts)[number], { id: Id }>;
export type GuardFor<Id extends RouteId> = GuardState<ContractById<Id>>;

export function contractById<Id extends RouteId>(id: Id): ContractById<Id> {
  const contract = routeContracts.find((route) => route.id === id);
  if (!contract) {
    throw new Error(`Missing route contract ${id}`);
  }
  return contract as ContractById<Id>;
}
