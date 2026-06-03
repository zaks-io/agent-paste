import { routeContractById, type RouteContractById, type RouteId } from "@agent-paste/contracts";
import type { GuardState } from "@agent-paste/worker-runtime";

export type RouteParams = Record<string, string>;
export type { RouteId };
export type ContractById<Id extends RouteId> = RouteContractById<Id>;
export type GuardFor<Id extends RouteId> = GuardState<ContractById<Id>>;

export { routeContractById as contractById };
