const ACCESS_LINK_ROUTE_ID = "/al/$publicId";
const ACCESS_LINK_PATH_PATTERN = /^\/al\/[^/]+\/?$/u;

type RouteMatch = {
  routeId?: string;
};

export function isExternalObservabilityBlockedPath(pathname: string | undefined): boolean {
  return typeof pathname === "string" && ACCESS_LINK_PATH_PATTERN.test(pathname);
}

export function isExternalObservabilityBlockedRoute(matches: ReadonlyArray<RouteMatch> | undefined): boolean {
  return matches?.some((match) => match.routeId === ACCESS_LINK_ROUTE_ID) ?? false;
}
