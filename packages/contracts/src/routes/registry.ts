import { actorRouteContracts } from "./registry.actor.js";
import { artifactRouteContracts } from "./registry.artifacts.js";
import { billingRouteContracts } from "./registry.billing.js";
import { ephemeralRouteContracts } from "./registry.ephemeral.js";
import { publicRouteContracts } from "./registry.public.js";
import { storageRouteContracts } from "./registry.storage.js";
import { webAdminRouteContracts } from "./registry.web-admin.js";
import { webRouteContracts } from "./registry.web.js";
import type { RouteContract } from "./types.js";

export const routeContracts = [
  ...actorRouteContracts,
  ...publicRouteContracts,
  ...ephemeralRouteContracts,
  ...artifactRouteContracts,
  ...webRouteContracts,
  ...webAdminRouteContracts,
  ...billingRouteContracts,
  ...storageRouteContracts,
] as const satisfies readonly RouteContract[];

export type RouteId = (typeof routeContracts)[number]["id"];
export type RouteContractById<Id extends RouteId> = Extract<(typeof routeContracts)[number], { id: Id }>;

export function routeContractById<Id extends RouteId>(id: Id): RouteContractById<Id> {
  const contract = routeContracts.find((route) => route.id === id);
  if (!contract) {
    throw new Error(`Unknown route contract: ${id}`);
  }
  return contract as RouteContractById<Id>;
}
