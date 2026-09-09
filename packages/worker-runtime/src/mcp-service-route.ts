import { type AppSurface, type RouteId, routeContractById } from "@agent-paste/contracts";

export function isAllowedMcpServiceRequest(
  request: Request,
  routeId: RouteId,
  app: AppSurface,
  allowedRouteIds: ReadonlySet<RouteId>,
): boolean {
  if (!allowedRouteIds.has(routeId)) {
    return false;
  }
  const contract = routeContractById(routeId);
  if (contract.app !== app || contract.method !== request.method) {
    return false;
  }
  return pathMatchesTemplate(new URL(request.url).pathname, contract.path);
}

function pathMatchesTemplate(path: string, template: string): boolean {
  const pathSegments = path.split("/");
  const templateSegments = template.split("/");
  if (pathSegments.length !== templateSegments.length) {
    return false;
  }
  return templateSegments.every((segment, index) => {
    const candidate = pathSegments[index];
    return segment.startsWith("{") && segment.endsWith("}") ? Boolean(candidate) : candidate === segment;
  });
}
