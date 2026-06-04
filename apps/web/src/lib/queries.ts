import { queryOptions } from "@tanstack/react-query";
import {
  getArtifactFn,
  listArtifactAccessLinksFn,
  listArtifactRevisionsFn,
  listArtifactsFn,
  listAuditFn,
  listKeysFn,
  loadAdminFn,
  loadDashboardFn,
  loadSettingsFn,
} from "../rpc/web-loaders";
import type { OperatorEventSearch } from "./operator-events";

/**
 * Single source of truth for query cache keys. Loaders, SSE handlers, and
 * mutations all import these so invalidation stays in sync with no
 * stringly-typed drift.
 */
export const queryKeys = {
  dashboard: () => ["dashboard"] as const,
  artifacts: () => ["artifacts"] as const,
  artifact: (artifactId: string) => ["artifact", artifactId] as const,
  artifactAccessLinks: (artifactId: string) => ["artifact-access-links", artifactId] as const,
  artifactRevisions: (artifactId: string) => ["artifact-revisions", artifactId] as const,
  audit: () => ["audit"] as const,
  keys: () => ["keys"] as const,
  settings: () => ["settings"] as const,
  admin: (search: OperatorEventSearch) => ["admin", search] as const,
};

export const dashboardQuery = () =>
  queryOptions({
    queryKey: queryKeys.dashboard(),
    queryFn: () => loadDashboardFn(),
  });

export const artifactsQuery = () =>
  queryOptions({
    queryKey: queryKeys.artifacts(),
    queryFn: () => listArtifactsFn(),
  });

export const artifactQuery = (artifactId: string) =>
  queryOptions({
    queryKey: queryKeys.artifact(artifactId),
    queryFn: () => getArtifactFn({ data: { artifactId } }),
  });

export const artifactAccessLinksQuery = (artifactId: string) =>
  queryOptions({
    queryKey: queryKeys.artifactAccessLinks(artifactId),
    queryFn: () => listArtifactAccessLinksFn({ data: { artifactId } }),
  });

export const artifactRevisionsQuery = (artifactId: string) =>
  queryOptions({
    queryKey: queryKeys.artifactRevisions(artifactId),
    queryFn: () => listArtifactRevisionsFn({ data: { artifactId } }),
  });

export const auditQuery = () =>
  queryOptions({
    queryKey: queryKeys.audit(),
    queryFn: () => listAuditFn(),
  });

export const keysQuery = () =>
  queryOptions({
    queryKey: queryKeys.keys(),
    queryFn: () => listKeysFn(),
  });

export const settingsQuery = () =>
  queryOptions({
    queryKey: queryKeys.settings(),
    queryFn: () => loadSettingsFn(),
  });

export const adminQuery = (search: OperatorEventSearch) =>
  queryOptions({
    queryKey: queryKeys.admin(search),
    queryFn: () => loadAdminFn({ data: search }),
  });
